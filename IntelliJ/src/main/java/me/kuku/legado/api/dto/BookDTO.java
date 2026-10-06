package me.kuku.legado.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * 书架中的书（阅读 Web 开放接口 GET /openapi/v1/shelf）
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class BookDTO {

    /** 书本 id，开放接口中用来获取目录、正文和保存进度 */
    @JsonProperty("id")
    private Long id;

    @JsonProperty("name")
    private String name;

    @JsonProperty("author")
    private String author;

    /** 书源名称 */
    @JsonProperty("originName")
    private String originName;

    @JsonProperty("coverUrl")
    private String coverUrl;

    @JsonProperty("intro")
    private String intro;

    @JsonProperty("kind")
    private String kind;

    @JsonProperty("latestChapterTitle")
    private String latestChapterTitle;

    @JsonProperty("totalChapterNum")
    private Integer totalChapterNum;

    /** 当前阅读章节序号（服务器目录中的序号，含卷名） */
    @JsonProperty("durChapterIndex")
    private Integer durChapterIndex = 0;

    /** 章节内阅读位置（本地使用：正文中的字符偏移） */
    private Integer durChapterPos = 0;

    /** 当前阅读章节标题 */
    @JsonProperty("durChapterTitle")
    private String durChapterTitle;

    /** 听书、视频、漫画（插件只支持文字书） */
    @JsonProperty("isAudio")
    private Boolean audio;

    @JsonProperty("isVideo")
    private Boolean video;

    @JsonProperty("isImage")
    private Boolean image;
}
