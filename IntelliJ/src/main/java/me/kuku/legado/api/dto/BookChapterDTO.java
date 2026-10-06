package me.kuku.legado.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * 章节（阅读 Web 开放接口 GET /openapi/v1/books/{id} 中的 chapters）
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class BookChapterDTO {

    /** 服务器目录中的章节序号（获取正文、保存进度时使用；卷名已在插件中过滤，所以与列表下标不一定相同） */
    @JsonProperty("index")
    private Integer index;

    @JsonProperty("title")
    private String title;

    /** 是否卷名（没有正文） */
    @JsonProperty("isVolume")
    private Boolean volume;
}
