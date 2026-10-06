package me.kuku.legado.toolwindow;

import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionToolbar;
import com.intellij.openapi.actionSystem.DefaultActionGroup;
import com.intellij.openapi.application.ApplicationManager;
import me.kuku.legado.api.ApiUtils;
import me.kuku.legado.api.dto.BookChapterDTO;
import me.kuku.legado.api.dto.BookDTO;
import me.kuku.legado.common.Constant;
import me.kuku.legado.dao.CurrentReadData;
import me.kuku.legado.inline.InlineReadMode;
import me.kuku.legado.state.State;
import lombok.Getter;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.event.AWTEventListener;
import java.awt.event.ActionListener;
import java.awt.event.AdjustmentListener;
import java.awt.event.KeyListener;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.MouseListener;
import java.awt.event.MouseMotionListener;
import java.awt.event.MouseWheelEvent;
import java.awt.event.MouseWheelListener;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Vector;
import java.util.concurrent.CompletableFuture;

@Getter
public class IndexUI {

    /**
     * 主面板
     */
    private JPanel rootPanel;

    /**
     * 书架面板
     */
    private JPanel bookshelfPanel;
    /**
     * 书架面板的目录的滚动面板
     */
    private JScrollPane bookshelfScrollPane;
    /**
     * 书架面板的目录表格
     */
    private JTable bookshelfTable;
    /**
     * 书架面板的错误提示
     */
    private JTextPane errorTipsPane;

    /**
     * 正文面板
     */
    private JPanel textBodyPanel;
    /**
     * 正文面板的操作按钮bar
     */
    private JToolBar bar1;
    /**
     * 正文面板的滚动面板
     */
    private JScrollPane textBodyScrollPane;
    /**
     * 正文面板的滚动面板中的正文
     */
    private JTextPane textBodyPane;
    private JToolBar bar2;

    private List<BookDTO> bookshelf = new ArrayList<>();

    private static final DefaultTableModel BOOK_SHELF_TABLE_MODEL = new DefaultTableModel(null, new String[]{"name", "current", "source", "author"}) {
        @Override
        public boolean isCellEditable(int row, int column) {
            // 表格不允许被编辑
            return false;
        }
    };

    private String currentPreLoad;

    /** 当前是否在正文阅读（决定显示 bar1 还是 bar2） */
    private boolean readingMode = false;
    /** 用户是否允许显示下方图标工具栏（标题栏按钮控制） */
    private boolean actionBarsVisible = true;

    /** 正文平滑滚动动画 */
    private Timer smoothScrollTimer;
    private int smoothScrollTarget;

    /** 章节选择：懒加载窗口，默认只展示当前附近 CHAPTER_PAGE 章 */
    private static final int CHAPTER_PAGE = 10;
    /** 弹层可见行数（高度，略矮） */
    private static final int CHAPTER_POPUP_VISIBLE_ROWS = 8;
    /** 仅弹层更窄；收起态保持普通下拉宽度 */
    private static final int CHAPTER_POPUP_WIDTH = 180;
    /**
     * 收起态：JComboBox 只负责“好看的外观 + 显示当前章”。
     * 交互：卸掉原生鼠标/弹层逻辑，全部走自定义 JWindow 列表。
     */
    private final JComboBox<ChapterOption> chapterCombo = new JComboBox<>() {
        @Override
        public void setPopupVisible(boolean visible) {
            if (visible) {
                showChapterPopup();
            } else {
                hideChapterPopup();
            }
        }

        @Override
        public boolean isPopupVisible() {
            return isChapterPopupShowing();
        }

        @Override
        public void showPopup() {
            showChapterPopup();
        }

        @Override
        public void hidePopup() {
            hideChapterPopup();
        }

        @Override
        public void updateUI() {
            super.updateUI();
            SwingUtilities.invokeLater(IndexUI.this::disarmNativeComboInteraction);
        }
    };
    private final DefaultListModel<ChapterOption> chapterListModel = new DefaultListModel<>();
    private final JList<ChapterOption> chapterList = new JList<>(chapterListModel);
    private final JScrollPane chapterListScroll = new JScrollPane(chapterList);
    /** 独立窗口弹层（比 JPopupMenu 滚轮可靠） */
    @Nullable
    private JWindow chapterPopupWindow;
    private int chapterWindowStart = 0;
    private int chapterWindowEnd = 0;
    private boolean chapterListUpdating = false;
    /** 点击弹层外部时关闭 */
    @Nullable
    private AWTEventListener chapterOutsideClickListener;
    /** 我们自己装的 toggle 监听（卸原生监听时要保留） */
    private final MouseAdapter chapterComboToggleMouse = new MouseAdapter() {
        @Override
        public void mousePressed(MouseEvent e) {
            if (!chapterCombo.isEnabled() || !SwingUtilities.isLeftMouseButton(e)) {
                return;
            }
            e.consume();
            toggleChapterPopup();
        }
    };

    private static final IndexUI INSTANCE = new IndexUI();

    public IndexUI() {
        // 隐藏正文面板
        textBodyPanel.setVisible(false);

        // 隐藏书架面板的错误提示
        errorTipsPane.setVisible(false);
        // 设置书架面板的错误提示为不可编辑
        errorTipsPane.setEditable(false);

        // 设置书架面板的表格数据格式
        bookshelfTable.setModel(IndexUI.BOOK_SHELF_TABLE_MODEL);

        final ActionManager actionManager = ActionManager.getInstance();
        ActionToolbar shelfBar = actionManager.createActionToolbar(Constant.PLUGIN_SHELF_BAR_ID, (DefaultActionGroup) actionManager.getAction(Constant.PLUGIN_SHELF_BAR_ID), true);
        shelfBar.setTargetComponent(bar1);
        bar1.add(shelfBar.getComponent());
        bar1.setBorderPainted(false);
        bar1.setFloatable(false);


        ActionToolbar actionToolbar = actionManager.createActionToolbar(Constant.PLUGIN_TOOL_BAR_ID, (DefaultActionGroup) actionManager.getAction(Constant.PLUGIN_TOOL_BAR_ID), true);
        actionToolbar.setTargetComponent(bar2);
        bar2.add(actionToolbar.getComponent());
        installChapterCombo();
        bar2.setBorderPainted(false);
        bar2.setFloatable(false);
        readingMode = false;
        applyActionBarsVisibility();
        bookshelfTable.addMouseListener(toTextBodyMouseAdapter());

        textBodyScrollPane.getVerticalScrollBar().addAdjustmentListener(preload());
        // 正文阅读：滚轮平滑滚动，避免默认 JScrollPane 步进瞬移
        installSmoothScrolling(textBodyScrollPane);
    }

    /**
     * 标题栏按钮：切换下方图标工具栏（刷新/返回/上下章等）显示。
     */
    public void toggleActionBars() {
        actionBarsVisible = !actionBarsVisible;
        applyActionBarsVisibility();
    }

    public boolean isActionBarsVisible() {
        return actionBarsVisible;
    }

    /**
     * 进入书架或正文时更新“当前模式”，再按用户开关决定是否显示对应工具栏。
     */
    private void setReadingMode(boolean reading) {
        this.readingMode = reading;
        applyActionBarsVisibility();
    }

    private void applyActionBarsVisibility() {
        if (!actionBarsVisible) {
            bar1.setVisible(false);
            bar2.setVisible(false);
            hideChapterPopup();
            return;
        }
        bar1.setVisible(!readingMode);
        bar2.setVisible(readingMode);
    }

    private void installChapterCombo() {
        chapterCombo.setToolTipText("选择章节（默认仅显示附近 10 章，可点两端加载更多）");
        // 收起态保持普通下拉宽度，只把弹层做窄
        chapterCombo.setPrototypeDisplayValue(ChapterOption.chapter(0, "第0000章 章节标题占位"));
        Dimension pref = chapterCombo.getPreferredSize();
        chapterCombo.setPreferredSize(new Dimension(Math.max(200, pref.width), pref.height));
        chapterCombo.setMaximumSize(new Dimension(280, pref.height + 4));
        chapterCombo.setEnabled(false);
        chapterCombo.setEditable(false);
        chapterCombo.setFocusable(false);
        // 收起态 model 只放“当前章”一项，用于显示；真正列表在 JWindow 里
        chapterCombo.setModel(new DefaultComboBoxModel<>());

        int rowH = Math.max(20, chapterList.getFont().getSize() + 8);
        chapterList.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        chapterList.setVisibleRowCount(CHAPTER_POPUP_VISIBLE_ROWS);
        chapterList.setFixedCellHeight(rowH);
        chapterList.setBorder(new EmptyBorder(1, 4, 1, 4));
        chapterList.setFocusable(true);
        chapterList.addMouseListener(new MouseAdapter() {
            @Override
            public void mousePressed(MouseEvent e) {
                if (!SwingUtilities.isLeftMouseButton(e)) {
                    return;
                }
                int index = chapterList.locationToIndex(e.getPoint());
                if (index < 0) {
                    return;
                }
                Rectangle bounds = chapterList.getCellBounds(index, index);
                if (bounds == null || !bounds.contains(e.getPoint())) {
                    return;
                }
                ChapterOption opt = chapterListModel.getElementAt(index);
                if (opt == null) {
                    return;
                }
                e.consume();
                onChapterOptionChosen(opt);
            }
        });

        chapterListScroll.setBorder(BorderFactory.createEmptyBorder());
        chapterListScroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        chapterListScroll.setVerticalScrollBarPolicy(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED);
        chapterListScroll.setWheelScrollingEnabled(true);
        chapterListScroll.getVerticalScrollBar().setUnitIncrement(rowH);
        chapterListScroll.getVerticalScrollBar().setBlockIncrement(rowH * 3);
        Dimension popupSize = new Dimension(CHAPTER_POPUP_WIDTH, rowH * CHAPTER_POPUP_VISIBLE_ROWS + 4);
        chapterListScroll.setPreferredSize(popupSize);
        chapterListScroll.setMinimumSize(popupSize);

        // 卸掉原生交互，只留我们自己的 toggle
        disarmNativeComboInteraction();
        SwingUtilities.invokeLater(this::disarmNativeComboInteraction);

        bar2.add(Box.createHorizontalStrut(8));
        bar2.add(chapterCombo);
    }

    private void toggleChapterPopup() {
        if (!chapterCombo.isEnabled()) {
            return;
        }
        if (isChapterPopupShowing()) {
            hideChapterPopup();
        } else {
            showChapterPopup();
        }
    }

    /**
     * 卸掉 ComboBoxUI 装的鼠标/键盘监听，避免原生弹层被打开；
     * 再挂上我们自己的 toggle。model 变更/UI 重装后都要再调一次。
     */
    private void disarmNativeComboInteraction() {
        // 1) 强制原生 popup 永远 show 我们的窗口（双保险）
        try {
            javax.swing.plaf.ComboBoxUI ui = chapterCombo.getUI();
            java.lang.reflect.Field popupField = findField(ui.getClass(), "popup");
            if (popupField != null) {
                popupField.setAccessible(true);
                Object current = popupField.get(ui);
                if (!(current instanceof ProxyComboPopup)) {
                    if (current instanceof javax.swing.plaf.basic.ComboPopup oldPopup) {
                        try {
                            oldPopup.hide();
                        } catch (Exception ignored) {
                        }
                    }
                    popupField.set(ui, new ProxyComboPopup());
                }
            }
        } catch (Exception ignored) {
        }

        // 2) 清掉 combo 及其子组件上的原生 mouse 监听，只保留我们的
        stripAndInstallToggle(chapterCombo);
        for (Component c : chapterCombo.getComponents()) {
            stripAndInstallToggle(c);
        }
    }

    private void stripAndInstallToggle(Component c) {
        if (c == null) {
            return;
        }
        for (MouseListener ml : c.getMouseListeners()) {
            if (ml != chapterComboToggleMouse) {
                c.removeMouseListener(ml);
            }
        }
        for (MouseMotionListener mml : c.getMouseMotionListeners()) {
            c.removeMouseMotionListener(mml);
        }
        for (MouseWheelListener mwl : c.getMouseWheelListeners()) {
            c.removeMouseWheelListener(mwl);
        }
        boolean has = false;
        for (MouseListener ml : c.getMouseListeners()) {
            if (ml == chapterComboToggleMouse) {
                has = true;
                break;
            }
        }
        if (!has) {
            c.addMouseListener(chapterComboToggleMouse);
        }
        // 箭头按钮上的 ActionListener 也会 toggle 原生弹层
        if (c instanceof AbstractButton button) {
            for (ActionListener al : button.getActionListeners()) {
                button.removeActionListener(al);
            }
        }
    }

    @Nullable
    private static java.lang.reflect.Field findField(Class<?> type, String name) {
        Class<?> c = type;
        while (c != null && c != Object.class) {
            try {
                return c.getDeclaredField(name);
            } catch (NoSuchFieldException ignored) {
                c = c.getSuperclass();
            }
        }
        return null;
    }

    /** 原生 ComboPopup 代理：任何 show 都进自定义窗口。 */
    private final class ProxyComboPopup implements javax.swing.plaf.basic.ComboPopup {
        @Override
        public void show() {
            showChapterPopup();
        }

        @Override
        public void hide() {
            hideChapterPopup();
        }

        @Override
        public boolean isVisible() {
            return isChapterPopupShowing();
        }

        @Override
        @SuppressWarnings({"rawtypes", "unchecked"})
        public JList getList() {
            return chapterList;
        }

        @Override
        public MouseListener getMouseListener() {
            return chapterComboToggleMouse;
        }

        @Override
        public MouseMotionListener getMouseMotionListener() {
            return null;
        }

        @Override
        public KeyListener getKeyListener() {
            return null;
        }

        @Override
        public void uninstallingUI() {
            hideChapterPopup();
        }
    }

    private boolean isChapterPopupShowing() {
        return chapterPopupWindow != null && chapterPopupWindow.isVisible();
    }

    private JWindow ensureChapterPopupWindow() {
        if (chapterPopupWindow != null) {
            return chapterPopupWindow;
        }
        Window owner = SwingUtilities.getWindowAncestor(chapterCombo);
        chapterPopupWindow = owner != null ? new JWindow(owner) : new JWindow();
        chapterPopupWindow.setFocusableWindowState(true);
        chapterPopupWindow.setType(Window.Type.POPUP);
        JPanel content = new JPanel(new BorderLayout());
        Color border = UIManager.getColor("Component.borderColor");
        if (border == null) {
            border = Color.GRAY;
        }
        content.setBorder(BorderFactory.createLineBorder(border));
        content.add(chapterListScroll, BorderLayout.CENTER);
        chapterPopupWindow.setContentPane(content);
        chapterPopupWindow.pack();
        return chapterPopupWindow;
    }

    private void attachOutsideClickCloser() {
        if (chapterOutsideClickListener != null) {
            return;
        }
        chapterOutsideClickListener = event -> {
            if (!(event instanceof MouseEvent me) || me.getID() != MouseEvent.MOUSE_PRESSED) {
                return;
            }
            if (!isChapterPopupShowing()) {
                return;
            }
            Component src = me.getComponent();
            if (src != null) {
                if (SwingUtilities.isDescendingFrom(src, chapterPopupWindow)
                        || SwingUtilities.isDescendingFrom(src, chapterCombo)) {
                    return;
                }
            }
            try {
                Point p = me.getLocationOnScreen();
                if (chapterPopupWindow != null && chapterPopupWindow.getBounds().contains(p)) {
                    return;
                }
                if (chapterCombo.isShowing()) {
                    Rectangle comboBounds = new Rectangle(chapterCombo.getLocationOnScreen(), chapterCombo.getSize());
                    if (comboBounds.contains(p)) {
                        return;
                    }
                }
            } catch (Exception ignored) {
            }
            SwingUtilities.invokeLater(this::hideChapterPopup);
        };
        Toolkit.getDefaultToolkit().addAWTEventListener(
                chapterOutsideClickListener,
                AWTEvent.MOUSE_EVENT_MASK
        );
    }

    private void detachOutsideClickCloser() {
        if (chapterOutsideClickListener == null) {
            return;
        }
        Toolkit.getDefaultToolkit().removeAWTEventListener(chapterOutsideClickListener);
        chapterOutsideClickListener = null;
    }

    private void hideChapterPopup() {
        detachOutsideClickCloser();
        if (chapterPopupWindow != null && chapterPopupWindow.isVisible()) {
            chapterPopupWindow.setVisible(false);
        }
    }

    private void showChapterPopup() {
        if (!chapterCombo.isEnabled() || !chapterCombo.isShowing()) {
            return;
        }
        if (isChapterPopupShowing()) {
            return;
        }
        if (chapterWindowEnd <= chapterWindowStart) {
            resetChapterWindowAroundCurrent();
        } else {
            ensureCurrentChapterInWindow();
        }
        rebuildChapterList(true);

        JWindow popup = ensureChapterPopupWindow();
        int rowH = Math.max(20, chapterList.getFixedCellHeight());
        // 窄、矮
        int width = CHAPTER_POPUP_WIDTH;
        int height = rowH * CHAPTER_POPUP_VISIBLE_ROWS + 4;
        Dimension size = new Dimension(width, height);
        chapterListScroll.setPreferredSize(size);
        chapterListScroll.setSize(size);
        popup.getContentPane().setPreferredSize(size);
        popup.pack();
        popup.setSize(size);

        Point onScreen = chapterCombo.getLocationOnScreen();
        popup.setLocation(onScreen.x, onScreen.y + chapterCombo.getHeight());
        popup.setVisible(true);
        attachOutsideClickCloser();

        int selected = chapterList.getSelectedIndex();
        if (selected >= 0) {
            chapterList.ensureIndexIsVisible(selected);
        } else {
            scrollChapterListTo(Math.max(0, chapterListModel.size() / 2));
        }
        SwingUtilities.invokeLater(() -> {
            chapterList.requestFocusInWindow();
            // 确保滚动条步进合理（JWindow 里原生滚轮即可用）
            JScrollBar bar = chapterListScroll.getVerticalScrollBar();
            bar.setUnitIncrement(rowH);
            bar.setBlockIncrement(rowH * 3);
        });
    }

    /**
     * 以当前章节为中心，初始化/重置为最近 CHAPTER_PAGE 章窗口。
     */
    private void resetChapterWindowAroundCurrent() {
        List<BookChapterDTO> chapters = CurrentReadData.getBookChapterList();
        if (chapters == null || chapters.isEmpty()) {
            chapterWindowStart = 0;
            chapterWindowEnd = 0;
            return;
        }
        int idx = CurrentReadData.getBookIndex();
        if (idx < 0) {
            idx = 0;
        }
        if (idx >= chapters.size()) {
            idx = chapters.size() - 1;
        }
        int half = CHAPTER_PAGE / 2;
        chapterWindowStart = Math.max(0, idx - half);
        chapterWindowEnd = Math.min(chapters.size(), chapterWindowStart + CHAPTER_PAGE);
        if (chapterWindowEnd - chapterWindowStart < CHAPTER_PAGE) {
            chapterWindowStart = Math.max(0, chapterWindowEnd - CHAPTER_PAGE);
        }
    }

    private void ensureCurrentChapterInWindow() {
        List<BookChapterDTO> chapters = CurrentReadData.getBookChapterList();
        if (chapters == null || chapters.isEmpty()) {
            return;
        }
        int idx = CurrentReadData.getBookIndex();
        if (idx < 0 || idx >= chapters.size()) {
            return;
        }
        if (chapterWindowEnd <= chapterWindowStart) {
            resetChapterWindowAroundCurrent();
            return;
        }
        if (idx < chapterWindowStart || idx >= chapterWindowEnd) {
            // 用上下章按钮跳到窗口外时，平移窗口而不是整表重开
            int half = CHAPTER_PAGE / 2;
            chapterWindowStart = Math.max(0, idx - half);
            chapterWindowEnd = Math.min(chapters.size(), chapterWindowStart + CHAPTER_PAGE);
            if (chapterWindowEnd - chapterWindowStart < CHAPTER_PAGE) {
                chapterWindowStart = Math.max(0, chapterWindowEnd - CHAPTER_PAGE);
            }
        }
    }

    /** 全量重建章节列表（打开书、切章、打开弹层时用）。 */
    private void rebuildChapterList(boolean keepPopup) {
        Runnable task = () -> {
            chapterListUpdating = true;
            try {
                List<BookChapterDTO> chapters = CurrentReadData.getBookChapterList();
                chapterListModel.clear();
                if (chapters == null || chapters.isEmpty()) {
                    chapterCombo.setEnabled(false);
                    chapterCombo.setModel(new DefaultComboBoxModel<>());
                    if (!keepPopup) {
                        hideChapterPopup();
                    }
                    return;
                }
                chapterCombo.setEnabled(true);
                ensureCurrentChapterInWindow();
                // 弹层列表：当前窗口（约 10 章 + 加载更多）
                fillChapterListModel(chapters);
                // 收起态 Combo：只显示当前章（好看、且原生弹层即使漏出也只有 1 项无意义）
                updateCollapsedComboDisplay(chapters);
                selectCurrentChapterInList();
                // model 变更后 UI 可能重新装监听
                disarmNativeComboInteraction();
            } finally {
                chapterListUpdating = false;
            }
        };
        if (SwingUtilities.isEventDispatchThread()) {
            task.run();
        } else {
            SwingUtilities.invokeLater(task);
        }
    }

    private void rebuildChapterCombo() {
        rebuildChapterList(true);
    }

    private void fillChapterListModel(List<BookChapterDTO> chapters) {
        int size = chapters.size();
        if (chapterWindowStart > 0) {
            chapterListModel.addElement(ChapterOption.morePrev(chapterWindowStart));
        }
        for (int i = chapterWindowStart; i < chapterWindowEnd && i < size; i++) {
            chapterListModel.addElement(toChapterOption(i, chapters.get(i)));
        }
        if (chapterWindowEnd < size) {
            chapterListModel.addElement(ChapterOption.moreNext(size - chapterWindowEnd));
        }
    }

    private void updateCollapsedComboDisplay(List<BookChapterDTO> chapters) {
        int idx = CurrentReadData.getBookIndex();
        DefaultComboBoxModel<ChapterOption> model = new DefaultComboBoxModel<>();
        if (idx >= 0 && idx < chapters.size()) {
            model.addElement(toChapterOption(idx, chapters.get(idx)));
        }
        chapterCombo.setModel(model);
        if (model.getSize() > 0) {
            chapterCombo.setSelectedIndex(0);
        }
    }

    private ChapterOption toChapterOption(int index, BookChapterDTO ch) {
        String title = ch.getTitle();
        if (title == null || title.isBlank()) {
            title = "第" + (index + 1) + "章";
        }
        return ChapterOption.chapter(index, title);
    }

    private void selectCurrentChapterInList() {
        int idx = CurrentReadData.getBookIndex();
        for (int i = 0; i < chapterListModel.size(); i++) {
            ChapterOption opt = chapterListModel.getElementAt(i);
            if (opt != null && opt.type == ChapterOption.Type.CHAPTER && opt.index == idx) {
                chapterList.setSelectedIndex(i);
                return;
            }
        }
        chapterList.clearSelection();
    }

    private void scrollChapterListTo(int listIndex) {
        if (chapterListModel.isEmpty()) {
            return;
        }
        int index = Math.max(0, Math.min(listIndex, chapterListModel.size() - 1));
        chapterList.ensureIndexIsVisible(index);
        Rectangle cell = chapterList.getCellBounds(index, index);
        if (cell != null) {
            chapterList.scrollRectToVisible(cell);
        }
    }

    /**
     * 向上扩展章节窗口：原地改 model，弹层保持打开，无闪烁。
     */
    private void expandChapterWindowPrev() {
        List<BookChapterDTO> chapters = CurrentReadData.getBookChapterList();
        if (chapters == null || chapters.isEmpty() || chapterWindowStart <= 0) {
            selectCurrentChapterInList();
            return;
        }
        int oldStart = chapterWindowStart;
        int newStart = Math.max(0, chapterWindowStart - CHAPTER_PAGE);
        if (newStart >= oldStart) {
            selectCurrentChapterInList();
            return;
        }

        // 记录当前视口顶部位置，插入后补偿滚动，避免“整页跳动”
        JScrollBar bar = chapterListScroll.getVerticalScrollBar();
        int oldValue = bar.getValue();
        int inserted = 0;

        chapterListUpdating = true;
        try {
            if (!chapterListModel.isEmpty()) {
                ChapterOption first = chapterListModel.getElementAt(0);
                if (first != null && first.type == ChapterOption.Type.MORE_PREV) {
                    chapterListModel.remove(0);
                }
            }
            for (int i = oldStart - 1; i >= newStart; i--) {
                chapterListModel.add(0, toChapterOption(i, chapters.get(i)));
                inserted++;
            }
            if (newStart > 0) {
                chapterListModel.add(0, ChapterOption.morePrev(newStart));
                inserted++;
            }
            chapterWindowStart = newStart;
            selectCurrentChapterInList();
        } finally {
            chapterListUpdating = false;
        }

        int rowH = Math.max(1, chapterList.getFixedCellHeight());
        bar.setValue(oldValue + inserted * rowH);
        // 把“加载更早 / 新插入的顶部”露出来，方便继续点
        scrollChapterListTo(0);
    }

    /**
     * 向下扩展章节窗口：原地改 model，弹层保持打开，无闪烁。
     */
    private void expandChapterWindowNext() {
        List<BookChapterDTO> chapters = CurrentReadData.getBookChapterList();
        int size = chapters == null ? 0 : chapters.size();
        if (chapters == null || size == 0 || chapterWindowEnd >= size) {
            selectCurrentChapterInList();
            return;
        }
        int oldEnd = chapterWindowEnd;
        int newEnd = Math.min(size, chapterWindowEnd + CHAPTER_PAGE);
        if (newEnd <= oldEnd) {
            selectCurrentChapterInList();
            return;
        }

        chapterListUpdating = true;
        try {
            int last = chapterListModel.size() - 1;
            if (last >= 0) {
                ChapterOption tail = chapterListModel.getElementAt(last);
                if (tail != null && tail.type == ChapterOption.Type.MORE_NEXT) {
                    chapterListModel.remove(last);
                }
            }
            for (int i = oldEnd; i < newEnd; i++) {
                chapterListModel.addElement(toChapterOption(i, chapters.get(i)));
            }
            if (newEnd < size) {
                chapterListModel.addElement(ChapterOption.moreNext(size - newEnd));
            }
            chapterWindowEnd = newEnd;
            selectCurrentChapterInList();
        } finally {
            chapterListUpdating = false;
        }

        scrollChapterListTo(chapterListModel.size() - 1);
    }

    private void onChapterOptionChosen(@NotNull ChapterOption opt) {
        if (chapterListUpdating) {
            return;
        }
        List<BookChapterDTO> chapters = CurrentReadData.getBookChapterList();
        int size = chapters == null ? 0 : chapters.size();

        if (opt.type == ChapterOption.Type.MORE_PREV) {
            expandChapterWindowPrev();
            return;
        }
        if (opt.type == ChapterOption.Type.MORE_NEXT) {
            expandChapterWindowNext();
            return;
        }

        int target = opt.index;
        if (target < 0 || target >= size) {
            return;
        }
        // 点当前章：只关弹层
        if (target == CurrentReadData.getBookIndex()) {
            hideChapterPopup();
            return;
        }
        CurrentReadData.setBookIndex(target);
        BookDTO book = CurrentReadData.getBook();
        if (book != null) {
            book.setDurChapterIndex(target);
            book.setDurChapterTitle(opt.title);
        }
        hideChapterPopup();
        switchChapter(0);
    }

    /**
     * 将默认滚轮“按步进瞬移”改为缓动滚动；触控板高精度事件则直接跟手。
     */
    private void installSmoothScrolling(JScrollPane scrollPane) {
        updateScrollIncrements();

        for (MouseWheelListener listener : scrollPane.getMouseWheelListeners()) {
            scrollPane.removeMouseWheelListener(listener);
        }

        scrollPane.addMouseWheelListener(e -> {
            if (!scrollPane.isWheelScrollingEnabled()) {
                return;
            }
            // Shift + 滚轮：横向
            if (e.isShiftDown()) {
                JScrollBar hBar = scrollPane.getHorizontalScrollBar();
                if (hBar != null && hBar.isVisible()) {
                    e.consume();
                    int unit = Math.max(16, hBar.getUnitIncrement());
                    hBar.setValue(hBar.getValue() + e.getUnitsToScroll() * unit);
                }
                return;
            }

            e.consume();
            JScrollBar bar = scrollPane.getVerticalScrollBar();
            int unit = Math.max(12, bar.getUnitIncrement());
            double precise = e.getPreciseWheelRotation();

            // 触控板等连续滚动：直接跟手，不做动画，避免拖泥带水
            if (Math.abs(precise) > 0 && Math.abs(precise) < 1.0) {
                int delta = (int) Math.round(precise * unit * 4);
                if (delta == 0) {
                    delta = precise > 0 ? 1 : -1;
                }
                bar.setValue(bar.getValue() + delta);
                return;
            }

            int delta = e.getUnitsToScroll() * unit;
            if (delta == 0) {
                delta = e.getWheelRotation() * unit * 3;
            }
            int base = (smoothScrollTimer != null && smoothScrollTimer.isRunning())
                    ? smoothScrollTarget
                    : bar.getValue();
            smoothScrollBy(bar, base + delta);
        });
    }

    private void updateScrollIncrements() {
        Font font = textBodyPane.getFont();
        int line = Math.max(16, font.getSize() + 8);
        JScrollBar bar = textBodyScrollPane.getVerticalScrollBar();
        bar.setUnitIncrement(line);
        bar.setBlockIncrement(line * 10);
    }

    private void smoothScrollBy(JScrollBar bar, int target) {
        int min = bar.getMinimum();
        int max = Math.max(min, bar.getMaximum() - bar.getVisibleAmount());
        smoothScrollTarget = Math.max(min, Math.min(max, target));

        if (smoothScrollTimer != null && smoothScrollTimer.isRunning()) {
            return;
        }

        smoothScrollTimer = new Timer(12, null);
        smoothScrollTimer.addActionListener(ev -> {
            int current = bar.getValue();
            int diff = smoothScrollTarget - current;
            if (Math.abs(diff) <= 1) {
                bar.setValue(smoothScrollTarget);
                smoothScrollTimer.stop();
                return;
            }
            // ease-out：剩余距离越大步子越大，接近目标时减速
            int step = (int) Math.ceil(Math.abs(diff) * 0.28);
            step = Math.max(1, Math.min(step, Math.abs(diff)));
            bar.setValue(current + (diff > 0 ? step : -step));
        });
        smoothScrollTimer.start();
    }

    private AdjustmentListener preload() {
        return e -> {
            Adjustable adjustable = e.getAdjustable();
            int value = adjustable.getValue();
            int max = adjustable.getMaximum();
            int extent = adjustable.getVisibleAmount();

            int totalRange = max - extent;
            double progress = 0.0;
            if (totalRange > 0) {
                progress = (double) value / totalRange;
            }
            if (progress > 0.5) {
                BookDTO book = CurrentReadData.getBook();
                int nextIndex = CurrentReadData.getBookIndex() + 1;
                if (nextIndex >= CurrentReadData.getBookChapterList().size()) {
                    return;
                }
                String key = book.getId() + ":" + nextIndex;
                if (!Objects.equals(key, currentPreLoad)) {
                    currentPreLoad = key;
                    ApplicationManager.getApplication().executeOnPooledThread(() -> {
                        ApiUtils.getBookContent(book, nextIndex);
                    });
                }
            }
        };
    }

    public void refreshBookshelf() {
        setReadingMode(false);
        bookshelfPanel.setVisible(true);
        hideErrorTips();
        CompletableFuture.supplyAsync(ApiUtils::getBookshelf)
                .thenAccept(books -> {
                    this.bookshelf = new ArrayList<>(books);
                    setBookshelfUI(books);
                }).exceptionally(throwable -> {
                    showErrorTips("获取书架列表失败: " + rootMessage(throwable));
                    return null;
                });
    }

    public void refreshTextBody() {
        initTextBodyUI();

        BookDTO book = CurrentReadData.getBook();
        CompletableFuture.supplyAsync(() -> ApiUtils.getChapterList(book))
                .thenAccept(bookChapters -> {
                    // 保存章节列表
                    CurrentReadData.setBookChapterList(bookChapters);

                    // 根据服务器上的阅读进度定位章节
                    int index = ApiUtils.resolveChapterIndex(book, bookChapters);
                    CurrentReadData.setBookIndex(index);
                    book.setDurChapterIndex(index);
                    if (index >= 0 && index < bookChapters.size()) {
                        book.setDurChapterTitle(bookChapters.get(index).getTitle());
                    }

                    // 章节下拉：只先展示当前附近 10 章
                    resetChapterWindowAroundCurrent();
                    rebuildChapterCombo();

                    // 设置正文数据
                    setTextBodyUIData(book.getDurChapterPos() == null ? 0 : book.getDurChapterPos());
                }).exceptionally(throwable -> {
                    showErrorTips(rootMessage(throwable));
                    return null;
                });
    }

    private MouseAdapter toTextBodyMouseAdapter() {
        return new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent evt) {
                int row = bookshelfTable.rowAtPoint(evt.getPoint());
                int col = bookshelfTable.columnAtPoint(evt.getPoint());

                if (row < 0 || col < 0 || row >= bookshelf.size()) {
                    return;
                }

                setReadingMode(true);
                // 保存当前阅读信息
                BookDTO book = bookshelf.get(row);
                CurrentReadData.setBook(book);
                CurrentReadData.setBookIndex(book.getDurChapterIndex() == null ? 0 : book.getDurChapterIndex());
                refreshTextBody();
            }
        };
    }

    private void setBookshelfUI(List<BookDTO> books) {
        // 清空表格
        IndexUI.BOOK_SHELF_TABLE_MODEL.getDataVector().clear();

        // 添加表格数据
        books.stream().map(book -> {
            Vector<String> bookVector = new Vector<>();
            bookVector.add(book.getName());
            String current = book.getDurChapterTitle();
            if (current == null || current.isBlank()) {
                current = book.getLatestChapterTitle();
            }
            bookVector.add(current);
            bookVector.add(book.getOriginName());
            bookVector.add(book.getAuthor());
            return bookVector;
        }).forEach(IndexUI.BOOK_SHELF_TABLE_MODEL::addRow);

        BOOK_SHELF_TABLE_MODEL.fireTableDataChanged();

        if (!bookshelfScrollPane.isShowing()) {
            bookshelfScrollPane.setVisible(true);
            errorTipsPane.setVisible(false);
        }
    }

    /**
     * 切换章节
     *
     * @param durChapterPos 当前在章节中的位置
     */
    public void switchChapter(int durChapterPos) {
        stopSmoothScroll();
        textBodyScrollPane.getVerticalScrollBar().setValue(0);

        // 设置正文面板UI
        initTextBodyUI();

        // 设置正文数据
        setTextBodyUIData(durChapterPos);
    }

    private void initTextBodyUI() {
        hideErrorTips();

        Font font = textBodyPane.getFont();
        int fontSize = State.getSettings().getTextBodyFontSize();
        if (fontSize > 0) {
            textBodyPane.setFont(new Font(font.getName(), font.getStyle(), fontSize));
        }
        updateScrollIncrements();
        // 设置加载中的提示
        textBodyPane.setText("加载中...");

        if (!textBodyPanel.isShowing()) {
            textBodyPanel.setVisible(true);
            bookshelfPanel.setVisible(false);
        }

        if (!textBodyScrollPane.isShowing()) {
            textBodyScrollPane.setVisible(true);
        }

        // 获取焦点到文本框
        textBodyPane.requestFocus();
    }

    private void stopSmoothScroll() {
        if (smoothScrollTimer != null && smoothScrollTimer.isRunning()) {
            smoothScrollTimer.stop();
        }
    }

    private void setTextBodyUIData(int durChapterPos) {
        BookDTO book = CurrentReadData.getBook();
        int index = CurrentReadData.getBookIndex();
        if (index < 0 || index >= CurrentReadData.getBookChapterList().size()) {
            showErrorTips("章节下标无效");
            return;
        }

        // 同步章节下拉选中项（上下章按钮切换时）
        rebuildChapterCombo();

        // 获取章节标题
        String title = CurrentReadData.getBookChapter().getTitle();

        // 用户主动换章时重置行内阅读分段（三击上一章末段由 InlineReadMode 自行处理）
        InlineReadMode.resetToFirstChunk();

        // 调用API获取正文内容
        CompletableFuture.supplyAsync(() -> ApiUtils.getBookContent(book, index))
                .thenAccept(bookContent -> {
                    CurrentReadData.setBodyContent(bookContent);
                    InlineReadMode.afterBodyLoaded();

                    // 设置正文内容
                    Runnable ui = () -> {
                        textBodyPane.setText(title + "\n" + bookContent);
                        int caret = Math.max(0, Math.min(durChapterPos, textBodyPane.getDocument().getLength()));
                        textBodyPane.setCaretPosition(caret);
                    };
                    if (SwingUtilities.isEventDispatchThread()) {
                        ui.run();
                    } else {
                        SwingUtilities.invokeLater(ui);
                    }
                }).exceptionally(throwable -> {
                    showErrorTips(rootMessage(throwable));
                    return null;
                });

        // 同步阅读进度
        CompletableFuture.runAsync(() -> ApiUtils.saveBookProgress(book, index));
    }

    private void hideErrorTips() {
        errorTipsPane.setVisible(false);
    }

    private void showErrorTips(String text) {
        textBodyPanel.setVisible(false);
        bookshelfPanel.setVisible(false);
        errorTipsPane.setVisible(true);
        errorTipsPane.setText(text);
    }

    private static String rootMessage(Throwable throwable) {
        Throwable t = throwable;
        while (t.getCause() != null) {
            t = t.getCause();
        }
        String msg = t.getMessage();
        return msg == null || msg.isBlank() ? t.toString() : msg;
    }

    public JComponent getComponent() {
        return rootPanel;
    }

    public static IndexUI getInstance() {
        return INSTANCE;
    }

    /**
     * 章节下拉项：真实章节，或“加载更多”。
     */
    private static final class ChapterOption {
        enum Type { CHAPTER, MORE_PREV, MORE_NEXT }

        final Type type;
        final int index;
        final String title;
        final int remaining;

        private ChapterOption(Type type, int index, String title, int remaining) {
            this.type = type;
            this.index = index;
            this.title = title;
            this.remaining = remaining;
        }

        static ChapterOption chapter(int index, @NotNull String title) {
            return new ChapterOption(Type.CHAPTER, index, title, 0);
        }

        static ChapterOption morePrev(int remaining) {
            return new ChapterOption(Type.MORE_PREV, -1, "▲ 加载更早章节（剩余 " + remaining + "）", remaining);
        }

        static ChapterOption moreNext(int remaining) {
            return new ChapterOption(Type.MORE_NEXT, -1, "▼ 加载更晚章节（剩余 " + remaining + "）", remaining);
        }

        @Override
        public String toString() {
            if (type == Type.CHAPTER) {
                return (index + 1) + ". " + title;
            }
            return title;
        }

        @Override
        public boolean equals(@Nullable Object o) {
            if (this == o) return true;
            if (!(o instanceof ChapterOption that)) return false;
            return type == that.type && index == that.index && Objects.equals(title, that.title);
        }

        @Override
        public int hashCode() {
            return Objects.hash(type, index, title);
        }
    }
}
