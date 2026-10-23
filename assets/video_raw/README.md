# Raw Footage Directory

Drop your recorded video clips here. The Remotion video editing suite (`video/`) will automatically read and stitch them into the final demo submission!

| File Name | Description | Key Audio / Line to Say |
|---|---|---|
| **`01_tired_alexa.mp4`** | You exhausted at desk, asking basic Alexa to finish homework. Phone says no. You toss phone on desk, sigh. | *"Hey Alexa, could you finish my homework for me?"* |
| **`02_prompt_homework.mp4`** | You holding phone with REACH orb, speaking the first command, then relaxing hands behind head. | *"Reach, open that assignment PDF on my desktop, solve problem 3, create the document, and open it for me."* |
| **`03_screen_homework.mp4`** | Laptop screen recording: REACH planner runs, solves problem, generates `.docx`, and Word/Pages launches on screen. | (Silent or system sounds) |
| **`04_prompt_research.mp4`** | You looking at screen, tapping phone orb to request diagrams and clipboard transfer. | *"Reach, research cellular respiration diagrams on the web, embed them into the document, and copy the executive summary to my phone's clipboard."* |
| **`05_screen_research.mp4`** | Laptop screen recording: Browser navigates, fetches diagram, embeds it into doc, and copies text to clipboard. | (Silent or system sounds) |
| **`06_phone_clipboard.mp4`** | Close-up of your phone: you open Notes/Chat, tap Paste, and the text appears (`Pasted from Mac`). | (Silence / tap sound) |
| **`07_sleepy_discord.mp4`** | Late night vibe: Discord on laptop screen with friend's voice asking for MOM. You slumped way down, drowsy whisper into phone, tap [Approve], eyes close completely. | Friend audio: *"Who's writing the MOM?"*<br>You (whisper): *"Reach... transcribe the sync recording in my Downloads and generate the MOM."* |
| **`08_screen_mom.mp4`** | Laptop screen recording: AWS Transcribe + Bedrock generate the minutes, and the formatted Word doc opens automatically. | (Silent or system sounds) |
| **`09_wake_up_clutch.mp4`** | Friend on laptop interrupts ("Hey! Are you awake?"). You jolt awake, look at screen, smile confidently, and read the key points. | Friend: *"Did you catch the summary?"*<br>You: *"Got it right here: sprint deadline is Friday midnight, backend deployment wraps tomorrow, and all action items are assigned."* |
| **`10_outro.mp4`** | You smiling at camera, holding up phone, relaxed. (3-5 seconds). | (Smile / camera fade) |

---

### Commands to Run:
- Preview video in Remotion Studio: `npm run video:dev` (or `cd video && npm run dev`)
- Render final MP4: `npm run video:build` (or `cd video && npm run build`)
