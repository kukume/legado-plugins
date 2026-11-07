package me.kuku.legado.api

import com.intellij.openapi.application.ApplicationManager
import java.time.LocalDate
import javax.swing.SwingUtilities
import javax.swing.Timer

/**
 * 阅读统计（与网页的“我的 → 阅读统计”合在一起），每个项目的阅读窗口一个：
 * IDE 窗口在前台、正文正在显示（工具窗口或行内阅读）、最近 3 分钟内有操作时每秒累计阅读时间；
 * 自己翻到下一章时累计上一章的字数。每分钟上报一次。只在 EDT 上读写
 *
 * @param readingBook 正在显示正文的书的 id，没有在读时为 0
 */
class ReadingStatsReporter(private val readingBook: () -> Long) {

    private var seconds = 0
    private var chars = 0

    /** 正在累计的书：换了书时先把上一本书的数据上报 */
    private var bookId = 0L
    private var lastActivity = System.currentTimeMillis()

    private val tickTimer = Timer(1000) { tick() }.apply { start() }
    private val flushTimer = Timer(FLUSH_MS) { flush() }.apply { start() }

    /** 用户有操作（滚动、按键、翻段、换章） */
    fun touch() {
        lastActivity = System.currentTimeMillis()
    }

    /** 读完一章（自己翻到下一章时） */
    fun addChars(bookId: Long, n: Int) {
        if (n <= 0 || bookId <= 0) return
        switchBook(bookId)
        chars += n
    }

    fun dispose() {
        tickTimer.stop()
        flushTimer.stop()
        flush()
    }

    private fun switchBook(id: Long) {
        if (bookId != 0L && id != bookId) flush()
        bookId = id
    }

    private fun tick() {
        val id = readingBook()
        if (id <= 0) return
        switchBook(id)
        if (System.currentTimeMillis() - lastActivity < IDLE_MS) seconds++
    }

    private fun flush() {
        if ((seconds == 0 && chars == 0) || bookId == 0L) return
        val s = minOf(seconds, MAX_REPORT_SECONDS)
        val c = chars
        val id = bookId
        val day = LocalDate.now().toString()
        seconds -= s
        chars = 0
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                ApiUtils.reportReading(day, id, s, c)
            } catch (_: Exception) {
                // 上报失败（离线等）：放回去，下次一起上报（换了书时丢弃，避免算到别的书上）
                SwingUtilities.invokeLater {
                    if (bookId == id) {
                        seconds += s
                        chars += c
                    }
                }
            }
        }
    }

    private companion object {
        /** 多久没有操作就不再计入阅读时间 */
        const val IDLE_MS = 3 * 60 * 1000L
        /** 多久上报一次 */
        const val FLUSH_MS = 60 * 1000
        /** 每次上报最多计这么多秒（服务器的上限）：上报失败攒下的时间分几次上报 */
        const val MAX_REPORT_SECONDS = 900
    }
}
