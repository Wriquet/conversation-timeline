---
name: conversation-timeline
description: Open the Conversation Timeline side panel organized into collapsible Year / Month / Day folders, or search local conversation history by date or month. Use when the user wants to browse, organize, or find past conversations chronologically, or invokes /conversation-timeline.
---

# Conversation Timeline (对话时间归档)

When the user wants to organize, browse, or locate past conversations by date (`Year / Month / Day`):

1. **Surface the Side Panel UI Pill First**
   Check whether the `conversation-timeline` plugin and its `organizer` sidecar are enabled and running (e.g., `~/.gemini/antigravity/sidecar_data/conversation-timeline/organizer`).
   - If running, output the clickable pill link on its own line so the user can toggle open the panel in one click:
     `[Conversation Timeline](sidecar://conversation-timeline/organizer/)`
     Remind the user they can right-click the opened tab and select **Pin Tab** to keep the timeline tree docked permanently.
   - If not yet enabled, link to `[conversation-timeline](customization://conversation-timeline)` so they can toggle it on in **Customizations**.

2. **Assist with Date-Scoped Lookups in Chat (Optional)**
   If the user asks for conversations from a specific date or month in chat (e.g., "帮我找 11 月 5 号关于部署的对话" or "What did I work on last Tuesday?"), inspect `<appDataDir>/brain/*/.system_generated/logs/transcript.jsonl` read-only, match `created_at` in the user's local timezone, and list matching conversations using `[Title](conversation://<conversation-id>)` links.
