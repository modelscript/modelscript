// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";

import { EMOJI_CATEGORIES, SKIN_TONES, type Emoji } from "../data/emojis";

interface SimpleEmojiPickerProps {
  onEmojiClick: (emojiData: { emoji: string }) => void;
}

export default function SimpleEmojiPicker({ onEmojiClick }: SimpleEmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [hoveredEmoji, setHoveredEmoji] = useState<Emoji | null>(null);
  const [skinTone, setSkinTone] = useState<string>(() => {
    try {
      return localStorage.getItem("emoji-skin-tone") || "";
    } catch {
      /* ignore */
      return "";
    }
  });
  const [showSkinTones, setShowSkinTones] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(EMOJI_CATEGORIES[0]!.title);
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const handleScroll = () => {
      if (!scrollRef.current) return;
      const containerTop = scrollRef.current.getBoundingClientRect().top;

      let currentActive = activeCategory;
      for (const cat of EMOJI_CATEGORIES) {
        const el = categoryRefs.current[cat.title];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= containerTop + 20) {
            currentActive = cat.title;
          }
        }
      }

      if (currentActive !== activeCategory) {
        setActiveCategory(currentActive);
      }
    };

    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", handleScroll);
      return () => scrollEl.removeEventListener("scroll", handleScroll);
    }
    return undefined;
  }, [activeCategory]);

  const filteredCategories = EMOJI_CATEGORIES.map((category) => {
    const filteredEmojis = category.emojis.filter(
      (emoji) => emoji.name.toLowerCase().includes(search.toLowerCase()) || emoji.char.includes(search),
    );
    return { ...category, emojis: filteredEmojis };
  }).filter((category) => category.emojis.length > 0);

  const getEmojiChar = (emoji: Emoji) => {
    if (!emoji.hasSkinTone || !skinTone) return emoji.char;
    // Remove the variation selector-16 (\uFE0F) before adding skin tone
    return emoji.char.replace(/\uFE0F/g, "") + skinTone;
  };

  const currentSkinColor = SKIN_TONES.find((s) => s.char === skinTone)?.color || SKIN_TONES[0]!.color;

  return (
    <div
      style={{
        backgroundColor: "var(--color-canvas-overlay, #ffffff)",
        border: "1px solid var(--color-border-default)",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        width: "320px",
        height: "400px",
        overflow: "hidden",
      }}
      onClick={(e) => {
        // Prevent click from bubbling up and closing
        e.stopPropagation();
      }}
    >
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: "var(--color-search-bg)",
            borderRadius: "9999px",
            padding: "4px 12px",
            border: searchFocused ? "1px solid var(--color-accent-cyan)" : "1px solid var(--color-search-border)",
            boxShadow: searchFocused ? "0 0 10px var(--color-search-focus)" : "none",
            margin: "0",
          }}
        >
          <SearchIcon size={16} fill={searchFocused ? "var(--color-accent-cyan)" : "var(--color-text-muted)"} />
          <input
            type="text"
            placeholder="Search emojis"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              padding: "4px 8px",
              width: "100%",
              color: "var(--color-fg-default)",
            }}
          />
        </div>
      </div>

      {!search && (
        <div
          style={{
            display: "flex",
            padding: "8px",
            borderBottom: "1px solid var(--color-border-subtle)",
            justifyContent: "space-between",
          }}
        >
          {EMOJI_CATEGORIES.map((cat) => {
            let catIcon = cat.icon;
            const catEmoji = cat.emojis.find((e) => e.char === cat.icon);
            if (catEmoji) {
              catIcon = getEmojiChar(catEmoji);
            }
            return (
              <button
                key={cat.title}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveCategory(cat.title);
                  if (categoryRefs.current[cat.title]) {
                    categoryRefs.current[cat.title]?.scrollIntoView({ behavior: "smooth" });
                  }
                }}
                title={cat.title}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "16px",
                  padding: "4px 4px 8px 4px",
                  marginBottom: "-9px",
                  borderBottom:
                    activeCategory === cat.title ? "2px solid var(--color-accent-purple)" : "2px solid transparent",
                  color: activeCategory === cat.title ? "var(--color-text-heading)" : "var(--color-text-muted)",
                }}
                onMouseOver={(e) => {
                  if (activeCategory !== cat.title) {
                    e.currentTarget.style.borderBottom = "2px solid var(--color-border)";
                  }
                }}
                onMouseOut={(e) => {
                  if (activeCategory !== cat.title) {
                    e.currentTarget.style.borderBottom = "2px solid transparent";
                  }
                }}
              >
                {catIcon}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "8px 12px",
        }}
      >
        {filteredCategories.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px", color: "var(--color-fg-muted)" }}>No emojis found</div>
        ) : (
          filteredCategories.map((category) => (
            <div
              key={category.title}
              ref={(el) => {
                categoryRefs.current[category.title] = el;
              }}
              style={{ marginBottom: "16px" }}
            >
              <div
                style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "8px", color: "var(--color-fg-default)" }}
              >
                {category.title}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: "4px",
                }}
              >
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji.char + skinTone}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onEmojiClick({ emoji: getEmojiChar(emoji) });
                    }}
                    onMouseEnter={() => setHoveredEmoji(emoji)}
                    onMouseLeave={() => setHoveredEmoji(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: "24px",
                      cursor: "pointer",
                      padding: 0,
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      justifySelf: "center",
                      transition: "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.1s ease",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--color-btn-secondary-bg)";
                      e.currentTarget.style.transform = "scale(1.25)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.transform = "scale(1)";
                    }}
                  >
                    {getEmojiChar(emoji)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--color-border-subtle)",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "50px",
          backgroundColor: "var(--color-canvas-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden", flex: 1 }}>
          {hoveredEmoji && !showSkinTones ? (
            <>
              <span style={{ fontSize: "28px", lineHeight: 1 }}>{getEmojiChar(hoveredEmoji)}</span>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "var(--color-fg-default)",
                }}
              >
                {hoveredEmoji.name}
              </span>
            </>
          ) : showSkinTones ? (
            <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
              {SKIN_TONES.map((tone) => (
                <button
                  key={tone.char || "default"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSkinTone(tone.char);
                    try {
                      localStorage.setItem("emoji-skin-tone", tone.char);
                    } catch {
                      /* ignore */
                    }
                    setShowSkinTones(false);
                  }}
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    backgroundColor: tone.color,
                    border:
                      skinTone === tone.char ? "2px solid var(--color-accent-cyan)" : "1px solid var(--color-border)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  title={tone.char ? `Skin tone ${tone.char}` : "Default"}
                />
              ))}
            </div>
          ) : (
            <span style={{ fontSize: "14px", color: "var(--color-fg-muted)" }}>Select an emoji</span>
          )}
        </div>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowSkinTones(!showSkinTones);
          }}
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            backgroundColor: currentSkinColor,
            border: "1px solid var(--color-border-default)",
            cursor: "pointer",
            flexShrink: 0,
            marginLeft: "8px",
          }}
          title="Change skin tone"
        />
      </div>
    </div>
  );
}
