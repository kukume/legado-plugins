package me.kuku.legado.action

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.Toggleable
import com.intellij.openapi.util.IconLoader

/**
 * 工具窗口标题栏按钮：显示/隐藏下方图标工具栏（书架刷新、返回/上下章等）。
 */
class ToggleActionBarAction : AnAction(
    "切换工具栏",
    "显示或隐藏下方图标按钮栏",
    IconLoader.getIcon("/icons/toggleBar.svg", ToggleActionBarAction::class.java)
), Toggleable {

    override fun actionPerformed(e: AnActionEvent) {
        val ui = e.reader() ?: return
        ui.toggleActionBars()
        updatePresentation(e, ui.isActionBarsVisible)
    }

    override fun update(e: AnActionEvent) {
        updatePresentation(e, e.reader()?.isActionBarsVisible ?: true)
        e.presentation.isEnabled = true
    }

    private fun updatePresentation(e: AnActionEvent, visible: Boolean) {
        Toggleable.setSelected(e.presentation, visible)
        e.presentation.text = if (visible) "隐藏工具栏" else "显示工具栏"
        e.presentation.description = if (visible) {
            "隐藏下方图标按钮栏"
        } else {
            "显示下方图标按钮栏"
        }
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT
}
