package me.kuku.legado.state

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

data class SettingsState(
    /** 阅读 Web 服务器地址，例如 http://192.168.1.10:8080 */
    var address: String = "",
    /** 开放接口的 API Key（在阅读 Web 的“我的 → API Key”中创建，lgd_ 开头） */
    var apiKey: String = "",
    var enableErrorLog: Boolean = false,
    var textBodyFontColor: String = "",
    var textBodyFont: String = "",
    var enableShowBodyInLine: Boolean = false,
    var textBodyFontSize: Int = 0,
    var textBodyFontName: String = "",
    /** 行内阅读：每段显示字数，默认 80 */
    var inlineReadChunkSize: Int = 80
)

@State(
    name = "Settings",
    storages = [Storage("LegadoReaderSettings.xml")]
)
@Service(Service.Level.PROJECT)
class SettingsService : PersistentStateComponent<SettingsState> {

    private var state: SettingsState = SettingsState()

    override fun getState(): SettingsState {
        return state
    }

    override fun loadState(state: SettingsState) {
        this.state = state
        if (this.state.inlineReadChunkSize <= 0) {
            this.state.inlineReadChunkSize = 80
        }
    }

    companion object {
        @JvmStatic
        fun getInstance(): SettingsService {
            return service()
        }
    }
}
