package me.kuku.legado.action

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class ShowBookInfoAction: AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
    }

    override fun update(e: AnActionEvent) {
        val reader = e.reader() ?: return
        val chapter = reader.currentChapter() ?: return
        e.presentation.setText(reader.book.name + " - " + chapter.title)
    }

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.EDT
    }
}
