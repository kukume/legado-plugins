package me.kuku.legado.action

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class TextBodyRefreshAction: AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        e.reader()?.refreshTextBody()
    }
}
