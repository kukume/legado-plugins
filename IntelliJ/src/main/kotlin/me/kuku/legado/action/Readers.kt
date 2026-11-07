package me.kuku.legado.action

import com.intellij.openapi.actionSystem.AnActionEvent
import me.kuku.legado.toolwindow.IndexUI

/** 动作所在项目的阅读窗口（每个项目一个；该项目还没打开过 Legado 工具窗口时为 null） */
internal fun AnActionEvent.reader(): IndexUI? = project?.let { IndexUI.getInstance(it) }
