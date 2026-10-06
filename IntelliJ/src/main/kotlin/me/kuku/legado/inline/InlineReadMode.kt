package me.kuku.legado.inline

import com.intellij.codeInsight.TargetElementUtil
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.event.EditorMouseEvent
import com.intellij.openapi.editor.event.EditorMouseEventArea
import com.intellij.openapi.editor.event.EditorMouseListener
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.ex.EditorPopupHandler
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.Key
import com.intellij.psi.PsiDocumentManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil
import me.kuku.legado.api.ApiUtils
import me.kuku.legado.dao.CurrentReadData
import me.kuku.legado.state.SettingsService
import me.kuku.legado.toolwindow.IndexUI
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.event.MouseEvent
import java.awt.font.FontRenderContext
import javax.swing.SwingUtilities

/**
 * 行内隐蔽阅读：把当前章节按可配置字数切分（默认 80），
 * 在编辑器光标右侧用 Inlay 显示。
 *
 * 鼠标逻辑（开启后）：
 * - 同行左键 → 下一段（连点也算）
 * - 同行右键 → 上一段，拦截 IDE 菜单
 * - 其它行左键 / 右键 → 只换位置显示，不切段；右键同样拦截菜单
 *
 * 修饰键：
 * - Ctrl+Alt / ⌘+Alt+左键：
 *   若当前位置 IDE 可跳转（实现/声明）→ 不处理，交给 IDE；
 *   否则开关行内阅读
 *
 * 接近章末时会预加载下一章正文到 ApiUtils 缓存。
 */
object InlineReadMode {

    private const val DEFAULT_CHUNK_SIZE = 80
    private const val PROP_ENABLED = "me.kuku.legado.inlineRead.enabled"
    /** 剩余段数 ≤ 此值时预加载下一章 */
    private const val PRELOAD_REMAINING_CHUNKS = 2

    /** 每段字数：读取设置，非法值回退默认 80 */
    @JvmStatic
    val chunkSize: Int
        get() {
            return try {
                val n = SettingsService.getInstance().state.inlineReadChunkSize
                if (n in 1..500) n else DEFAULT_CHUNK_SIZE
            } catch (_: Exception) {
                DEFAULT_CHUNK_SIZE
            }
        }

    @Volatile
    private var enabledInternal: Boolean =
        PropertiesComponent.getInstance().getBoolean(PROP_ENABLED, false)

    private var chunkIndex: Int = 0

    @Volatile
    private var pendingJumpToLastChunk: Boolean = false

    /**
     * 章末切下一章后，正文异步加载尚未完成。
     * 期间禁止再按旧 body 切片，等 afterBodyLoaded 后刷新第一段。
     */
    @Volatile
    private var pendingShowAfterLoad: Boolean = false

    /** 已发起预加载的 key，避免重复打接口 */
    @Volatile
    private var preloadedNextKey: String? = null

    private val parentDisposable = Disposer.newDisposable("legado-inline-read")
    private var listenerInstalled = false
    private val POPUP_HANDLER_KEY = Key.create<EditorPopupHandler>("me.kuku.legado.inline.popupHandler")

    /** 当前显示的 inlay */
    private var activeInlay: Inlay<*>? = null
    private var activeEditor: Editor? = null
    /** 上次显示时所在的文档行号；用于判断是否“同一行再点” */
    private var lastShowLine: Int = -1
    private var lastShowEditor: Editor? = null

    /**
     * 开启行内模式后：无修饰键右键一律拦截 IDE 菜单
     * （同行上一段 / 其它行换位，都由我们处理）。
     */
    private val popupSuppressHandler = EditorPopupHandler { event ->
        if (!enabled) return@EditorPopupHandler false
        if (!isEditingArea(event)) return@EditorPopupHandler false
        val me = event.mouseEvent
        if (me.isControlDown || me.isMetaDown || me.isAltDown || me.isShiftDown) {
            return@EditorPopupHandler false
        }
        me.consume()
        try {
            event.editor.selectionModel.removeSelection()
        } catch (_: Exception) {
        }
        true
    }

    private val mouseListener = object : EditorMouseListener {
        /**
         * 跳段 / 换位尽量在 pressed 完成。
         * 同行判定只用鼠标 Y → 逻辑行，不用 caret。
         * 显示位置也用鼠标落点。
         */
        override fun mousePressed(event: EditorMouseEvent) {
            if (!isEditingArea(event)) return
            val me = event.mouseEvent
            val editor = event.editor
            ensurePopupHandler(editor)

            // 左键 Ctrl+Alt：开关行内阅读（无跳转目标时）
            if (SwingUtilities.isLeftMouseButton(me) && isCtrlAlt(me)) {
                handleCtrlAltToggle(editor, me)
                return
            }

            if (!enabled) return
            FileDocumentManager.getInstance().getFile(editor.document) ?: return

            val plain = !me.isControlDown && !me.isMetaDown && !me.isAltDown && !me.isShiftDown
            if (!plain) return

            // 右键：显示行 → 上一段；其它行 / 未显示 → 换位显示（与左键换行相同）
            if (SwingUtilities.isRightMouseButton(me)) {
                if (isShowingOn(editor) && isClickOnLastShowLine(editor, me)) {
                    handleStepClick(editor, me, forward = false)
                } else {
                    // 首次或换行：只换位置，不切段
                    relocateOnly(editor, me)
                    me.consume()
                }
                return
            }

            // 左键：显示行 → 下一段；其它行留给 clicked 换位
            if (SwingUtilities.isLeftMouseButton(me)) {
                if (isShowingOn(editor) && isClickOnLastShowLine(editor, me)) {
                    handleStepClick(editor, me, forward = true)
                }
            }
        }

        override fun mouseReleased(event: EditorMouseEvent) {
            if (!enabled) return
            if (!isEditingArea(event)) return
            val me = event.mouseEvent
            if (!SwingUtilities.isRightMouseButton(me) && !me.isPopupTrigger) return
            if (me.isControlDown || me.isMetaDown || me.isAltDown || me.isShiftDown) return
            // 开启后无修饰键右键一律拦住菜单
            me.consume()
            try {
                event.editor.selectionModel.removeSelection()
            } catch (_: Exception) {
            }
        }

        override fun mouseClicked(event: EditorMouseEvent) {
            if (!isEditingArea(event)) return
            val me = event.mouseEvent
            val editor = event.editor
            ensurePopupHandler(editor)

            // 右键：pressed 已处理跳段/换位；这里只继续 consume 防菜单
            if (SwingUtilities.isRightMouseButton(me) || me.isPopupTrigger) {
                if (enabled &&
                    !me.isControlDown && !me.isMetaDown && !me.isAltDown && !me.isShiftDown
                ) {
                    me.consume()
                }
                return
            }

            if (!SwingUtilities.isLeftMouseButton(me)) return
            if (isCtrlAlt(me) || me.isConsumed) return
            if (!enabled) return
            FileDocumentManager.getInstance().getFile(editor.document) ?: return

            val plainClick = !me.isControlDown && !me.isMetaDown && !me.isAltDown && !me.isShiftDown
            if (!plainClick) return

            // 同行已在 pressed 跳段；这里只处理「首次显示 / 换行换位置」
            if (isShowingOn(editor) && isClickOnLastShowLine(editor, me)) return
            relocateOnly(editor, me)
        }
    }

    private fun isEditingArea(event: EditorMouseEvent): Boolean {
        if (event.area != EditorMouseEventArea.EDITING_AREA) return false
        return !event.editor.isDisposed
    }

    /** 鼠标落点是否在上次显示的那一行（仅看鼠标坐标，不看 caret） */
    private fun isClickOnLastShowLine(editor: Editor, me: MouseEvent): Boolean {
        if (lastShowEditor !== editor || lastShowLine < 0) return false
        val line = lineUnderMouse(editor, me)
        return line >= 0 && line == lastShowLine
    }

    private fun lineUnderMouse(editor: Editor, me: MouseEvent): Int {
        return try {
            val visual = editor.xyToVisualPosition(me.point)
            val logical = editor.visualToLogicalPosition(visual)
            // 点在文件末尾空白：logical.line 可能被夹到最后一行，但仍应用鼠标视觉行
            // 若点击 Y 明显在最后一行之下，视为「非本行」
            val doc = editor.document
            if (doc.lineCount > 0) {
                val lastLine = doc.lineCount - 1
                val lastLineY = editor.logicalPositionToXY(
                    com.intellij.openapi.editor.LogicalPosition(lastLine, 0)
                ).y
                val lineHeight = editor.lineHeight
                if (me.y > lastLineY + lineHeight) {
                    return -2 // 文件下方空白，绝不算同行
                }
            }
            logical.line
        } catch (_: Exception) {
            -1
        }
    }

    /**
     * 同行连点：每次按下跳一段（前进或后退）。
     * 显示位置强制用鼠标落点，不用 caret（右键不会移动 caret）。
     */
    private fun handleStepClick(editor: Editor, me: MouseEvent, forward: Boolean) {
        me.consume()
        try {
            editor.selectionModel.removeSelection()
        } catch (_: Exception) {
        }

        val place = placeFromMouse(editor, me)
        if (pendingShowAfterLoad) {
            showInlay(editor, "加载中…", place)
            return
        }
        if (plainBody().isBlank()) {
            showInlay(editor, "暂无正文，请先在 Legado Reader 打开一章", place)
            return
        }

        val loading = if (forward) nextChunk() else previousChunk()
        if (loading) {
            showInlay(editor, "加载中…", place)
        } else {
            showCurrent(editor, place)
        }
    }

    /** 换行 / 首次：只换位置显示当前段，绝不 next/prev */
    private fun relocateOnly(editor: Editor, me: MouseEvent) {
        val place = placeFromMouse(editor, me)
        if (pendingShowAfterLoad) {
            showInlay(editor, "加载中…", place)
            return
        }
        if (plainBody().isBlank()) {
            showInlay(editor, "暂无正文，请先在 Legado Reader 打开一章", place)
            return
        }
        // 左键换行时同步 caret，方便继续编辑；显示仍按 place
        if (SwingUtilities.isLeftMouseButton(me)) {
            try {
                editor.caretModel.moveToOffset(place.offset)
            } catch (_: Exception) {
            }
        }
        showCurrent(editor, place)
    }

    private data class Place(val offset: Int, val line: Int)

    /** 用鼠标坐标计算显示位置；同行右键时夹在 lastShowLine 上，避免跑到 caret 所在行 */
    private fun placeFromMouse(editor: Editor, me: MouseEvent): Place {
        val mouseLine = lineUnderMouse(editor, me)
        val line = when {
            mouseLine >= 0 -> mouseLine
            lastShowEditor === editor && lastShowLine >= 0 -> lastShowLine
            else -> try {
                editor.document.getLineNumber(editor.caretModel.offset)
            } catch (_: Exception) {
                0
            }
        }
        val offset = try {
            val visual = editor.xyToVisualPosition(me.point)
            val logical = editor.visualToLogicalPosition(visual)
            val targetLine = if (line >= 0) line else logical.line
            val col = logical.column.coerceAtLeast(0)
            editor.logicalPositionToOffset(LogicalPosition(targetLine.coerceAtLeast(0), col))
                .coerceIn(0, editor.document.textLength)
        } catch (_: Exception) {
            offsetUnderMouse(editor, me)
        }
        val finalLine = try {
            editor.document.getLineNumber(offset)
        } catch (_: Exception) {
            line
        }
        return Place(offset, finalLine)
    }

    private fun isCtrlAlt(me: MouseEvent): Boolean {
        val ctrlOrMeta = me.isControlDown || me.isMetaDown
        return ctrlOrMeta && me.isAltDown && !me.isShiftDown
    }

    /**
     * Ctrl+Alt+单击：有跳转目标则放行；否则开关行内阅读。
     * 监听始终安装，关闭状态下也能用来打开。
     */
    private fun handleCtrlAltToggle(editor: Editor, me: MouseEvent) {
        FileDocumentManager.getInstance().getFile(editor.document) ?: return
        val offset = offsetUnderMouse(editor, me)
        if (hasIdeNavigationTarget(editor, offset)) {
            // 交给 IDE：跳转实现 / 声明
            return
        }
        me.consume()
        val on = toggle()
        if (on) {
            // 打开后若有正文，在当前光标旁显示当前段
            if (plainBody().isNotBlank()) {
                showCurrent(editor)
            }
        }
    }

    private fun offsetUnderMouse(editor: Editor, me: MouseEvent): Int {
        return try {
            val logical = editor.xyToLogicalPosition(me.point)
            editor.logicalPositionToOffset(logical).coerceIn(0, editor.document.textLength)
        } catch (_: Exception) {
            editor.caretModel.offset.coerceIn(0, editor.document.textLength)
        }
    }

    /**
     * 当前位置 IDE 是否可能触发「跳转到声明/实现」。
     * 有目标则返回 true，行内阅读不抢快捷键。
     */
    private fun hasIdeNavigationTarget(editor: Editor, offset: Int): Boolean {
        val project = editor.project ?: return false
        return try {
            ReadAction.compute<Boolean, RuntimeException> {
                PsiDocumentManager.getInstance(project).getPsiFile(editor.document)
                    ?: return@compute false

                // flags 兼容不同平台版本：优先反射 getAllAccepted / REFERENCED_ELEMENT_ACCEPTED
                val flags = resolveTargetFlags()
                val util = TargetElementUtil.getInstance()
                val target = util.findTargetElement(editor, flags, offset)
                if (target != null) {
                    return@compute true
                }
                val ref = try {
                    TargetElementUtil.findReference(editor, offset)
                } catch (_: Throwable) {
                    null
                }
                if (ref != null) {
                    try {
                        if (ref.resolve() != null) return@compute true
                    } catch (_: Exception) {
                        // 有引用但解析异常，仍视为可能可跳转，避免抢键
                        return@compute true
                    }
                }
                false
            }
        } catch (_: Throwable) {
            // 探测失败：保守起见不抢（让 IDE 自己决定）
            true
        }
    }

    private fun resolveTargetFlags(): Int {
        // 1) TargetElementUtil.getAllAccepted()
        try {
            val m = TargetElementUtil::class.java.getMethod("getAllAccepted")
            val v = m.invoke(null)
            if (v is Int) return v
        } catch (_: Throwable) {
        }
        // 2) 常量字段 REFERENCED_ELEMENT_ACCEPTED | ELEMENT_NAME_ACCEPTED 等
        var flags = 0
        var found = false
        for (name in listOf(
            "REFERENCED_ELEMENT_ACCEPTED",
            "ELEMENT_NAME_ACCEPTED",
            "LOOKUPITEM_ACCEPTED",
        )) {
            try {
                val f = TargetElementUtil::class.java.getField(name)
                flags = flags or (f.getInt(null))
                found = true
            } catch (_: Throwable) {
            }
        }
        if (found) return flags
        // 3) 兜底：-1 表示尽量全接受（部分实现会按 bit 过滤）
        return -1
    }

    @JvmStatic
    var enabled: Boolean
        get() = enabledInternal
        set(value) {
            if (enabledInternal == value) {
                if (value) ensureListener()
                return
            }
            enabledInternal = value
            PropertiesComponent.getInstance().setValue(PROP_ENABLED, value, false)
            if (value) {
                ensureListener()
            } else {
                pendingShowAfterLoad = false
                clearInlay()
            }
        }

    @JvmStatic
    fun toggle(): Boolean {
        enabled = !enabled
        return enabled
    }

    @JvmStatic
    fun resetToFirstChunk() {
        if (!pendingJumpToLastChunk) {
            chunkIndex = 0
        }
    }

    @JvmStatic
    fun afterBodyLoaded() {
        val text = plainBody()
        if (text.isEmpty()) {
            chunkIndex = 0
            pendingJumpToLastChunk = false
            pendingShowAfterLoad = false
            return
        }
        if (pendingJumpToLastChunk) {
            pendingJumpToLastChunk = false
            chunkIndex = maxChunkIndex(text)
        } else {
            chunkIndex = chunkIndex.coerceIn(0, maxChunkIndex(text))
        }
        // 章末切章后 body 异步到达：用新章内容刷新当前 inlay（通常是第一段）
        if (pendingShowAfterLoad) {
            pendingShowAfterLoad = false
            ApplicationManager.getApplication().invokeLater {
                if (!enabled) return@invokeLater
                val editor = activeEditor?.takeUnless { it.isDisposed }
                    ?: lastShowEditor?.takeUnless { it.isDisposed }
                    ?: return@invokeLater
                showCurrent(editor)
            }
        }
    }

    /**
     * 始终安装监听：即使行内阅读关闭，Ctrl+Alt+单击仍可用于开启。
     */
    @JvmStatic
    fun ensureListener() {
        if (listenerInstalled) return
        val factory = EditorFactory.getInstance()
        factory.eventMulticaster.addEditorMouseListener(mouseListener, parentDisposable)
        // 现有编辑器 + 后续新建编辑器都挂上右键菜单拦截
        factory.addEditorFactoryListener(object : EditorFactoryListener {
            override fun editorCreated(event: EditorFactoryEvent) {
                ensurePopupHandler(event.editor)
            }
        }, parentDisposable)
        for (editor in factory.allEditors) {
            ensurePopupHandler(editor)
        }
        listenerInstalled = true
    }

    private fun ensurePopupHandler(editor: Editor) {
        val ex = editor as? EditorEx ?: return
        if (editor.getUserData(POPUP_HANDLER_KEY) != null) return
        ex.installPopupHandler(popupSuppressHandler)
        editor.putUserData(POPUP_HANDLER_KEY, popupSuppressHandler)
    }

    private fun isShowingOn(editor: Editor): Boolean {
        return activeInlay != null &&
                activeInlay?.isValid == true &&
                activeEditor === editor
    }

    private fun plainBody(): String {
        return CurrentReadData.bodyContent
            .replace("\r\n", "\n")
            .replace('\r', '\n')
            .trim()
    }

    private fun maxChunkIndex(text: String): Int {
        if (text.isEmpty()) return 0
        val size = chunkSize
        return (text.length - 1) / size
    }

    private fun currentChunkText(): String {
        val text = plainBody()
        if (text.isEmpty()) return ""
        val size = chunkSize
        val max = maxChunkIndex(text)
        chunkIndex = chunkIndex.coerceIn(0, max)
        val start = chunkIndex * size
        val end = minOf(start + size, text.length)
        return text.substring(start, end).replace('\n', ' ')
    }

    /**
     * 推进到下一段。
     * @return true 表示已发起切章、正文尚未就绪，调用方不要立刻用旧 body 显示
     */
    private fun nextChunk(): Boolean {
        if (pendingShowAfterLoad) return true
        val text = plainBody()
        if (text.isEmpty()) return false
        val max = maxChunkIndex(text)
        if (chunkIndex < max) {
            chunkIndex++
            maybePreloadNextChapter(max)
            return false
        }
        // 本章读完 → 下一章第一段（body 异步加载，先标记 pending）
        val chapters = CurrentReadData.bookChapterList
        val idx = CurrentReadData.bookIndex
        if (idx >= 0 && idx + 1 < chapters.size) {
            CurrentReadData.indexAtomicIncrement()
            chunkIndex = 0
            pendingShowAfterLoad = true
            ApplicationManager.getApplication().invokeLater {
                IndexUI.getInstance().switchChapter(0)
            }
            return true
        }
        return false
    }

    /**
     * 回退到上一段。
     * @return true 表示已发起切章（上一章末段）、正文尚未就绪
     */
    private fun previousChunk(): Boolean {
        if (pendingShowAfterLoad) return true
        val text = plainBody()
        if (text.isEmpty()) return false
        if (chunkIndex > 0) {
            chunkIndex--
            return false
        }
        // 本章第一段 → 上一章最后一段
        val chapters = CurrentReadData.bookChapterList
        val idx = CurrentReadData.bookIndex
        if (idx > 0 && idx < chapters.size) {
            CurrentReadData.indexAtomicDecrement()
            pendingJumpToLastChunk = true
            pendingShowAfterLoad = true
            ApplicationManager.getApplication().invokeLater {
                IndexUI.getInstance().switchChapter(0)
            }
            return true
        }
        return false
    }

    /**
     * 接近章末时预拉下一章正文，写入 ApiUtils bookCache。
     * 与正文窗口 scroll > 50% 的 preload 共用同一缓存，切章可秒开。
     */
    private fun maybePreloadNextChapter(maxChunk: Int = maxChunkIndex(plainBody())) {
        if (!enabled) return
        val remaining = maxChunk - chunkIndex
        if (remaining > PRELOAD_REMAINING_CHUNKS) return

        val book = CurrentReadData.book
        val nextIndex = CurrentReadData.bookIndex + 1
        val chapters = CurrentReadData.bookChapterList
        if (nextIndex < 0 || nextIndex >= chapters.size) return

        val key = "${book.id}:$nextIndex"
        if (key == preloadedNextKey) return
        preloadedNextKey = key

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                ApiUtils.getBookContent(book, nextIndex)
            } catch (_: Exception) {
                // 预加载失败不打扰阅读；允许下次再试
                if (preloadedNextKey == key) {
                    preloadedNextKey = null
                }
            }
        }
    }

    private fun showCurrent(editor: Editor, place: Place? = null) {
        val chunk = currentChunkText()
        if (chunk.isBlank()) {
            showInlay(editor, "（无内容）", place)
            return
        }
        val text = plainBody()
        val max = maxChunkIndex(text)
        val progress = "${chunkIndex + 1}/${max + 1}"
        showInlay(editor, "$chunk ·$progress", place)
        maybePreloadNextChapter(max)
    }

    private fun showInlay(editor: Editor, text: String, place: Place? = null) {
        if (editor.isDisposed) return
        ApplicationManager.getApplication().invokeLater {
            if (editor.isDisposed) return@invokeLater
            clearInlay()
            // 优先用调用方给出的鼠标落点；不要默认 caret（右键后 caret 常停在别的行）
            val offset = (place?.offset ?: editor.caretModel.offset)
                .coerceIn(0, editor.document.textLength)
            val line = place?.line?.takeIf { it >= 0 } ?: try {
                editor.document.getLineNumber(offset)
            } catch (_: Exception) {
                -1
            }
            val font = resolveDisplayFont(editor, text)
            val color = JBColor(0x6A6A6A, 0x9A9A9A)
            val renderer = ChunkInlayRenderer(text, font, color)
            val inlay = editor.inlayModel.addInlineElement(offset, true, renderer)
            if (inlay != null) {
                activeInlay = inlay
                activeEditor = editor
                lastShowEditor = editor
                lastShowLine = line
            }
        }
    }

    private fun clearInlay() {
        try {
            activeInlay?.dispose()
        } catch (_: Exception) {
        }
        activeInlay = null
        activeEditor = null
        lastShowEditor = null
        lastShowLine = -1
    }

    /**
     * 选一个能显示中文的字体：优先编辑器字体，不行再兜底系统中文字体。
     */
    private fun resolveDisplayFont(editor: Editor, sample: String): Font {
        val size = editor.colorsScheme.editorFontSize.coerceAtLeast(11)
        val editorFont = editor.colorsScheme.getFont(EditorFontType.PLAIN).deriveFont(size.toFloat())
        if (canDisplayAll(editorFont, sample)) {
            return editorFont
        }
        val candidates = listOf(
            "Microsoft YaHei UI",
            "Microsoft YaHei",
            "PingFang SC",
            "Hiragino Sans GB",
            "Noto Sans CJK SC",
            "Source Han Sans SC",
            "WenQuanYi Micro Hei",
            "SimHei",
            "SimSun",
            "Dialog"
        )
        for (name in candidates) {
            val f = Font(name, Font.PLAIN, size)
            if (canDisplayAll(f, sample)) {
                return f
            }
        }
        return UIUtil.getLabelFont().deriveFont(size.toFloat())
    }

    private fun canDisplayAll(font: Font, sample: String): Boolean {
        if (sample.isEmpty()) return true
        return font.canDisplayUpTo(sample) == -1
    }

    private class ChunkInlayRenderer(
        private val text: String,
        private val font: Font,
        private val color: java.awt.Color
    ) : EditorCustomElementRenderer {

        private val paddingLeft = 6
        private val paddingRight = 4

        override fun calcWidthInPixels(inlay: Inlay<*>): Int {
            val frc = FontRenderContext(null, true, true)
            val w = font.getStringBounds(text, frc).width
            return (w + paddingLeft + paddingRight).toInt().coerceAtLeast(8)
        }

        override fun paint(
            inlay: Inlay<*>,
            g: Graphics,
            targetRegion: Rectangle,
            textAttributes: TextAttributes
        ) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.font = font
                g2.color = color
                val fm = g2.fontMetrics
                val x = targetRegion.x + paddingLeft
                val y = targetRegion.y + fm.ascent +
                        ((targetRegion.height - fm.height) / 2).coerceAtLeast(0)
                g2.drawString(text, x, y)
            } finally {
                g2.dispose()
            }
        }
    }
}
