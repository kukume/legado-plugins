package me.kuku.legado.action

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class NextChapterAction: AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        e.reader()?.nextChapter()
    }
}
