package me.kuku.legado.api

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import me.kuku.legado.state.SettingsService
import okhttp3.Call
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** 其他端保存的阅读进度（GET /openapi/v1/events，事件名 progress） */
data class ProgressEvent(
    val bookId: Long,
    /** 服务器目录中的章节序号 */
    val index: Int,
    /** 章内位置（比例 0~10000） */
    val pos: Int,
    val title: String?,
)

/**
 * 多端同步：订阅其他端保存的阅读进度（SSE）。断线自动重连；地址或 API Key 改了时调用 [restart]。
 * 请求头 X-Client-Id 与保存进度时相同（[ApiUtils.clientId]），服务器不会把本端保存的进度推送回来，
 * 所以同一个 IDE 里不同项目窗口之间的进度由 [publishLocal] 在本地转发
 */
object ProgressStream {

    private val log = Logger.getInstance(ProgressStream::class.java)

    /** 服务器每 25 秒发一次心跳；超过这么久没有任何数据就认为连接已断开 */
    private val client by lazy {
        ApiUtils.client.newBuilder().readTimeout(70, TimeUnit.SECONDS).build()
    }

    /** 每个项目的阅读窗口一个 */
    private val listeners = java.util.concurrent.CopyOnWriteArrayList<(ProgressEvent) -> Unit>()

    /** 每次（重新）开始加一：旧的连接线程发现代数变了就退出 */
    @Volatile
    private var generation = 0

    @Volatile
    private var call: Call? = null

    @JvmStatic
    fun addListener(l: (ProgressEvent) -> Unit) {
        listeners.add(l)
    }

    @JvmStatic
    fun removeListener(l: (ProgressEvent) -> Unit) {
        listeners.remove(l)
    }

    /** 本 IDE 的某个项目窗口保存了进度：转发给其他项目窗口（source 为发出者自己的监听） */
    @JvmStatic
    fun publishLocal(e: ProgressEvent, source: (ProgressEvent) -> Unit) {
        ApplicationManager.getApplication().invokeLater {
            listeners.forEach { if (it !== source) it(e) }
        }
    }

    @JvmStatic
    @Synchronized
    fun restart() {
        stop()
        val s = SettingsService.getInstance().state
        if (s.address.isBlank() || s.apiKey.isBlank()) return
        val gen = generation
        ApplicationManager.getApplication().executeOnPooledThread { loop(gen) }
    }

    @JvmStatic
    @Synchronized
    fun stop() {
        generation++
        call?.cancel()
        call = null
    }

    private fun loop(gen: Int) {
        // 断线后重连的等待时间：从 3 秒开始逐次加倍，最多 60 秒
        var wait = 3_000L
        while (gen == generation) {
            try {
                if (connect(gen)) wait = 3_000L
            } catch (e: Exception) {
                if (gen != generation) return
                log.debug("进度同步连接断开: ${e.message}")
            }
            if (gen != generation) return
            Thread.sleep(wait)
            wait = (wait * 2).coerceAtMost(60_000L)
        }
    }

    /** 连接并读取事件，直到断开；连上过返回 true */
    private fun connect(gen: Int): Boolean {
        val s = SettingsService.getInstance().state
        val base = s.address.trim().trimEnd('/')
        if (base.isBlank() || s.apiKey.isBlank()) return false
        val request = Request.Builder()
            .url("$base/openapi/v1/events")
            .header("Accept", "text/event-stream")
            .build()
        val c = client.newCall(request)
        synchronized(this) {
            if (gen != generation) return false
            call = c
        }
        c.execute().use { response ->
            if (!response.isSuccessful) {
                // API Key 无效时不必频繁重试
                if (response.code == 401) Thread.sleep(60_000)
                return false
            }
            val source = response.body.source()
            var event = "message"
            val data = StringBuilder()
            while (gen == generation) {
                val line = source.readUtf8Line() ?: break
                when {
                    line.isEmpty() -> {
                        if (event == "progress" && data.isNotEmpty()) dispatch(data.toString())
                        event = "message"
                        data.setLength(0)
                    }
                    line.startsWith("event:") -> event = line.substring(6).trim()
                    line.startsWith("data:") -> {
                        if (data.isNotEmpty()) data.append('\n')
                        data.append(line.substring(5).removePrefix(" "))
                    }
                }
            }
            return true
        }
    }

    private fun dispatch(json: String) {
        val e = try {
            val node = ApiUtils.objectMapper.readTree(json)
            ProgressEvent(
                bookId = node["bookId"]?.asLong() ?: return,
                index = node["index"]?.asInt() ?: return,
                pos = node["pos"]?.asInt() ?: 0,
                title = node["title"]?.takeIf { !it.isNull }?.asString(),
            )
        } catch (_: Exception) {
            return
        }
        ApplicationManager.getApplication().invokeLater { listeners.forEach { it(e) } }
    }
}
