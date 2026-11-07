package me.kuku.legado.gui;

import com.intellij.openapi.options.SearchableConfigurable;
import com.intellij.ui.JBColor;
import me.kuku.legado.common.Constant;
import me.kuku.legado.state.SettingsService;
import me.kuku.legado.state.SettingsState;
import me.kuku.legado.toolwindow.IndexUI;
import me.kuku.legado.gui.ui.SettingUI;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;

public class SettingFactory implements SearchableConfigurable {

    private final static String DISPLAY_NAME = "Legado";

    private final static SettingUI SETTING_UI = new SettingUI();

    @Override
    public @NotNull String getId() {
        return Constant.PLUGIN_SETTING_ID;
    }

    @Override
    public @Nls(capitalization = Nls.Capitalization.Title) String getDisplayName() {
        return SettingFactory.DISPLAY_NAME;
    }

    @Override
    public @Nullable JComponent createComponent() {
        return SETTING_UI.getComponent();
    }

    @Override
    public boolean isModified() {
        return true;
    }

    @Override
    public void reset() {
        SETTING_UI.readSettings();
    }

    @Override
    public void apply() {
        SETTING_UI.saveSettings();
        SettingsState state = SettingsService.getInstance().getState();
        int rgb = Integer.parseInt(state.getTextBodyFontColor());
        JBColor jbColor = new JBColor(new Color(rgb), new Color(rgb));
        for (IndexUI ui : IndexUI.instances()) {
            ui.getTextBodyPane().setForeground(jbColor);
            // 字号 0 表示不单独设置：保留当前字号（直接用 0 会让正文看不见）
            Font current = ui.getTextBodyPane().getFont();
            int size = state.getTextBodyFontSize() > 0 ? state.getTextBodyFontSize() : current.getSize();
            ui.getTextBodyPane().setFont(new Font(state.getTextBodyFontName(), Font.PLAIN, size));
        }
        // 地址或 API Key 可能改了：重新连接多端同步
        me.kuku.legado.api.ProgressStream.restart();
    }

    public static SettingUI instance() {
        return SETTING_UI;
    }
}
