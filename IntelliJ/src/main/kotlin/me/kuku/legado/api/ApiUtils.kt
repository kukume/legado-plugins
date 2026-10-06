package me.kuku.legado.api

import com.google.common.cache.CacheBuilder
import me.kuku.legado.api.dto.BookChapterDTO
import me.kuku.legado.api.dto.BookDTO
import me.kuku.legado.state.SettingsService
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import tools.jackson.databind.JsonNode
import tools.jackson.module.kotlin.jsonMapper
import tools.jackson.module.kotlin.kotlinModule
import java.util.concurrent.TimeUnit

/**
 * 阅读 Web 开放接口客户端（API Key 鉴权，请求头 X-API-Key）。
 *
 * 书架：GET /openapi/v1/shelf
 * 目录：GET /openapi/v1/books/{id}
 * 正文：GET /openapi/v1/books/{id}/content?index=&saveProgress=false
 * 进度：PUT /openapi/v1/books/{id}/progress  body={index, title}
 */
object ApiUtils {

    private const val PREFIX = "/openapi/v1"

    /** 正文缓存：预加载下一章后，切章可以直接显示 */
    private val bookCache = CacheBuilder.newBuilder()
        .maximumSize(20)
        .expireAfterWrite(10, TimeUnit.MINUTES)
        .build<String, String>()

    private val mediaType = "application/json; charset=utf-8".toMediaType()

    private val settingsState by lazy {
        SettingsService.getInstance().state
    }

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            // 正文没有缓存时服务器要向书源请求，可能比较慢
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val builder = chain.request().newBuilder()
                    .header("Accept", "application/json")
                    .header("X-API-Key", settingsState.apiKey.trim())
                chain.proceed(builder.build())
            }
            .build()
    }

    val objectMapper = jsonMapper {
        addModule(kotlinModule())
    }

    private fun baseUrl(): String = settingsState.address.trim().trimEnd('/')

    private fun ensureConfigured() {
        if (baseUrl().isBlank()) error("请先在 Settings → Tools → Legado Reader 中填写服务器地址")
        if (settingsState.apiKey.isBlank()) error("请先在 Settings → Tools → Legado Reader 中填写 API Key（在阅读 Web 的“我的 → API Key”中创建）")
    }

    /** 发送请求；出错时取服务器返回的 { error } 作为提示 */
    private fun call(request: Request): JsonNode {
        return client.newCall(request).execute().use { response ->
            val body = response.body.string()
            val json = try {
                if (body.isBlank()) null else objectMapper.readTree(body)
            } catch (_: Exception) {
                null
            }
            if (!response.isSuccessful) {
                val msg = json?.get("error")?.takeIf { !it.isNull }?.asString()
                error(msg ?: "HTTP ${response.code}: ${body.take(200)}")
            }
            json ?: error("接口返回非 JSON")
        }
    }

    private fun get(path: String, query: Map<String, String> = emptyMap()): JsonNode {
        ensureConfigured()
        val url = (baseUrl() + PREFIX + path).toHttpUrl().newBuilder()
        query.forEach { (k, v) -> url.addQueryParameter(k, v) }
        return call(Request.Builder().url(url.build()).get().build())
    }

    private fun putJson(path: String, json: String): JsonNode {
        ensureConfigured()
        return call(Request.Builder().url(baseUrl() + PREFIX + path).put(json.toRequestBody(mediaType)).build())
    }

    /** 正文转为纯文本：去掉图片等标签（段评气泡等），解码常见实体 */
    private fun toPlainText(content: String): String {
        if (content.isBlank()) return content
        val text = if (!content.contains('<')) content else content
            .replace(Regex("(?i)<br\\s*/?>"), "\n")
            .replace(Regex("(?i)</p\\s*>"), "\n")
            .replace(Regex("(?i)</div\\s*>"), "\n")
            .replace(Regex("(?i)<[^>]+>"), "")
        return text
            .replace("&nbsp;", " ")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&amp;", "&")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }

    private fun requireId(book: BookDTO): Long = book.id ?: error("缺少书本 id，请刷新书架")

    /** 书架（只保留文字书：听书、视频、漫画不支持） */
    @JvmStatic
    fun getBookshelf(): List<BookDTO> {
        val books: List<BookDTO> = objectMapper.readValue(
            objectMapper.writeValueAsString(get("/shelf")),
            objectMapper.typeFactory.constructCollectionType(List::class.java, BookDTO::class.java),
        )
        return books.filter { it.audio != true && it.video != true && it.image != true }
    }

    /** 目录（去掉卷名）；顺便用服务器上最新的阅读进度更新 book */
    @JvmStatic
    fun getChapterList(book: BookDTO): List<BookChapterDTO> {
        val json = get("/books/${requireId(book)}")
        json["book"]?.let { b ->
            b["durChapterIndex"]?.takeIf { !it.isNull }?.let { book.durChapterIndex = it.asInt() }
            b["durChapterTitle"]?.takeIf { !it.isNull }?.let { book.durChapterTitle = it.asString() }
        }
        val chapters: List<BookChapterDTO> = objectMapper.readValue(
            objectMapper.writeValueAsString(json["chapters"]),
            objectMapper.typeFactory.constructCollectionType(List::class.java, BookChapterDTO::class.java),
        )
        return chapters.filter { it.volume != true && it.index != null }
    }

    /** 兼容旧签名：仅 bookUrl 无法拉目录，请使用 getChapterList(BookDTO) */
    @JvmStatic
    fun getChapterList(bookUrl: String): List<BookChapterDTO> {
        error("请使用 getChapterList(BookDTO)，当前 bookUrl=$bookUrl")
    }

    /**
     * 正文（index 为目录列表下标）。不记录进度：预加载下一章时也会调用，进度由 [saveBookProgress] 单独保存
     */
    @JvmStatic
    fun getBookContent(book: BookDTO, index: Int): String {
        val chapters = me.kuku.legado.dao.CurrentReadData.bookChapterList
        require(index in chapters.indices) { "章节下标越界: $index / ${chapters.size}" }
        val serverIndex = chapters[index].index ?: error("章节缺少序号")
        val id = requireId(book)
        val cacheKey = "$id:$serverIndex"
        bookCache.getIfPresent(cacheKey)?.let { return it }
        val json = get("/books/$id/content", mapOf("index" to serverIndex.toString(), "saveProgress" to "false"))
        val raw = json["content"]?.takeIf { !it.isNull }?.asString().orEmpty()
        if (raw.isBlank()) error("正文为空")
        val text = toPlainText(raw)
        bookCache.put(cacheKey, text)
        return text
    }

    /** 兼容旧签名 */
    @JvmStatic
    fun getBookContent(bookUrl: String, index: Int): String {
        return getBookContent(me.kuku.legado.dao.CurrentReadData.book, index)
    }

    /** 保存阅读进度（index 为目录列表下标）；失败不影响阅读 */
    @JvmStatic
    fun saveBookProgress(book: BookDTO, index: Int) {
        val id = book.id ?: return
        val chapters = me.kuku.legado.dao.CurrentReadData.bookChapterList
        if (index !in chapters.indices) return
        val chapter = chapters[index]
        val serverIndex = chapter.index ?: return
        val payload = objectMapper.createObjectNode().apply {
            put("index", serverIndex)
            put("title", chapter.title.orEmpty())
        }
        try {
            putJson("/books/$id/progress", objectMapper.writeValueAsString(payload))
            book.durChapterIndex = serverIndex
            book.durChapterTitle = chapter.title
        } catch (_: Exception) {
            // 进度同步失败不影响阅读
        }
    }

    /** 兼容旧签名 */
    @JvmStatic
    fun saveBookProgress(bookUrl: String, index: Int) {
        saveBookProgress(me.kuku.legado.dao.CurrentReadData.book, index)
    }

    /**
     * 根据书的阅读进度（服务器目录序号）定位到目录列表下标：
     * 进度停在卷名上时取它后面的第一章；找不到时按标题匹配，再不行从头开始
     */
    @JvmStatic
    fun resolveChapterIndex(book: BookDTO, chapters: List<BookChapterDTO>): Int {
        val dur = book.durChapterIndex
        if (dur != null && dur >= 0) {
            val exact = chapters.indexOfFirst { it.index == dur }
            if (exact >= 0) return exact
            val after = chapters.indexOfFirst { (it.index ?: -1) > dur }
            if (after >= 0) return after
        }
        val byTitle = book.durChapterTitle
        if (!byTitle.isNullOrBlank()) {
            val found = chapters.indexOfFirst { it.title == byTitle }
            if (found >= 0) return found
        }
        return 0
    }
}
