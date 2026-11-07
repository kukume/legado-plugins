package me.kuku.legado.action

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class PreviousChapterAction: AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        e.reader()?.previousChapter()
    }
}
