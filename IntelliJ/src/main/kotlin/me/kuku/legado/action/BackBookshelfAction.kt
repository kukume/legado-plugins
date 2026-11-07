package me.kuku.legado.action

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class BackBookshelfAction: AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val indexUI = e.reader() ?: return
        indexUI.refreshBookshelf()

        indexUI.textBodyPanel.isVisible = false;
        indexUI.bookshelfPanel.isVisible = true;
    }
}
