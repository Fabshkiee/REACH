import React from "react";
import { Sequence } from "remotion";
import { VideoScene } from "./components/VideoScene";
import { SubtitleBar } from "./components/SubtitleBar";
import { HudOverlay } from "./components/HudOverlay";
import { ReachOrb } from "./components/ReachOrb";
import { OutroCard } from "./components/OutroCard";

export const MainVideo: React.FC = () => {
  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        position: "relative",
        backgroundColor: "#030712",
        overflow: "hidden",
      }}
    >
      {/* SCENE 1 */}
      <Sequence from={0} durationInFrames={180}>
        <VideoScene
          fileName="01_tired_alexa.mp4"
          shotTitle="01: The Voice Assistant Wall"
          description="Exhausted at desk, asking basic Alexa to finish homework. Phone says no. You toss phone on desk, sigh."
        />
        <SubtitleBar
          speaker="You"
          speakerColor="#94a3b8"
          text="“Hey Alexa, could you finish my homework for me?”"
        />
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 60,
            padding: "10px 20px",
            background: "rgba(239, 68, 68, 0.2)",
            border: "1px solid #ef4444",
            borderRadius: 12,
            color: "#fca5a5",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "0.05em",
          }}
        >
          ✕ STANDARD ASSISTANT: CANNOT ACT ON LOCAL MACHINES
        </div>
      </Sequence>

      {/* SCENE 2 */}
      <Sequence from={180} durationInFrames={240}>
        <VideoScene
          fileName="02_prompt_homework.mp4"
          shotTitle="02: REACH First Intent"
          description="Holding phone with REACH orb, speaking the first command, then relaxing hands behind head."
        />
        <div style={{ position: "absolute", top: 48, left: 48 }}>
          <ReachOrb size={90} mode="listening" />
        </div>
        <HudOverlay
          badgeTitle="DEVICE MESH · MACBOOK PRO"
          actionList={["files.search (assignment.pdf)", "bedrock.reason", "files.create_document", "apps.open"]}
          activeStep={0}
        />
        <SubtitleBar
          speaker="You (via REACH)"
          speakerColor="#38bdf8"
          text="“Reach, open that assignment PDF on my desktop, solve problem 3, create the document, and open it for me.”"
        />
      </Sequence>

      {/* SCENE 3 */}
      <Sequence from={420} durationInFrames={300}>
        <VideoScene
          fileName="03_screen_homework.mp4"
          shotTitle="03: Autonomous Execution on Desktop"
          description="Screen recording: REACH planner runs, solves problem, generates .docx, and Word/Pages launches."
        />
        <HudOverlay
          badgeTitle="EXECUTING WORKFLOW"
          actionList={[
            "✓ Read assignment.pdf",
            "▶ Claude 3.5 Sonnet: Solved Problem 3",
            "▶ Generated homework-solution.docx",
            "▶ Launched Microsoft Word",
          ]}
          activeStep={2}
          highlightText="Zero Cloud Copying: Directly authored on local disk"
        />
        <SubtitleBar
          speaker="REACH"
          speakerColor="#10b981"
          text="“Done. I’ve solved problem 3, created the Word document, and opened it on your screen.”"
        />
      </Sequence>

      {/* SCENE 4 */}
      <Sequence from={720} durationInFrames={240}>
        <VideoScene
          fileName="04_prompt_research.mp4"
          shotTitle="04: Multi-Modal Web & Clipboard"
          description="Looking at screen, tapping phone orb to request diagrams and clipboard transfer."
        />
        <div style={{ position: "absolute", top: 48, left: 48 }}>
          <ReachOrb size={90} mode="listening" />
        </div>
        <HudOverlay
          badgeTitle="CROSS-DEVICE ACTION"
          actionList={["web.research (diagrams)", "files.embed_image", "clipboard.sync (to phone)"]}
          activeStep={0}
        />
        <SubtitleBar
          speaker="You"
          speakerColor="#38bdf8"
          text="“Reach, research cellular respiration diagrams on the web, embed them into the document, and copy the executive summary to my phone's clipboard.”"
        />
      </Sequence>

      {/* SCENE 5 */}
      <Sequence from={960} durationInFrames={240}>
        <VideoScene
          fileName="05_screen_research.mp4"
          shotTitle="05: Browser Navigation & Doc Insertion"
          description="Screen recording: Browser navigates, fetches diagram, embeds it into doc, and copies text to clipboard."
        />
        <HudOverlay
          badgeTitle="PLAYWRIGHT + MCP DESKTOP"
          actionList={[
            "✓ Browser navigated to Wikipedia diagram",
            "✓ Downloaded SVG asset",
            "✓ Embedded into active Word doc",
            "▶ Broadcast clipboard payload to mesh",
          ]}
          activeStep={3}
        />
        <SubtitleBar
          speaker="REACH"
          speakerColor="#10b981"
          text="“Diagram embedded into section 2. Executive summary copied to your phone’s clipboard.”"
        />
      </Sequence>

      {/* SCENE 6 */}
      <Sequence from={1200} durationInFrames={180}>
        <VideoScene
          fileName="06_phone_clipboard.mp4"
          shotTitle="06: Seamless Clipboard Arrival"
          description="Close-up of your phone: you open Notes/Chat, tap Paste, and the text appears (Pasted from Mac)."
        />
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 24px",
            background: "rgba(16, 185, 129, 0.2)",
            border: "1px solid #10b981",
            borderRadius: 999,
            color: "#6ee7b7",
            fontSize: 16,
            fontWeight: 700,
            boxShadow: "0 0 20px rgba(16, 185, 129, 0.3)",
          }}
        >
          ✓ E2E ENCRYPTED CLIPBOARD: PASTED FROM MAC
        </div>
      </Sequence>

      {/* SCENE 7 */}
      <Sequence from={1380} durationInFrames={300}>
        <VideoScene
          fileName="07_sleepy_discord.mp4"
          shotTitle="07: Late Night Meeting Minutes"
          description="Discord sync on laptop. You drowsy whisper into phone, tap [Approve], eyes close completely."
        />
        <div style={{ position: "absolute", top: 48, left: 48 }}>
          <ReachOrb size={90} mode="gate" />
        </div>
        <HudOverlay
          badgeTitle="CONSEQUENTIAL POLICY GATE"
          actionList={["audio.transcribe (Amazon Transcribe)", "Uploads 105s recording to S3", "Approval: GRANTED"]}
          activeStep={2}
          highlightText="Policy Engine: Uploading audio requires human-in-the-loop signoff"
        />
        <SubtitleBar
          speaker="Friend & You"
          speakerColor="#f59e0b"
          text="Friend: “Who’s writing the MOM?” — You: “Reach... transcribe the sync recording in my Downloads and generate the MOM.”"
        />
      </Sequence>

      {/* SCENE 8 */}
      <Sequence from={1680} durationInFrames={360}>
        <VideoScene
          fileName="08_screen_mom.mp4"
          shotTitle="08: Cloud Intelligence, Local Document"
          description="AWS Transcribe + Bedrock generate the minutes, and the formatted Word doc opens automatically."
        />
        <HudOverlay
          badgeTitle="HERO PIPELINE RUNNING"
          actionList={[
            "✓ Amazon Transcribe: 4 speakers identified",
            "✓ AWS Bedrock: Extracted decisions & owners",
            "✓ Formatted executive Word minutes",
            "✓ Opened product-sync-mom.docx",
          ]}
          activeStep={3}
          highlightText="Zero manual typing. Completed in ~22 seconds."
        />
        <SubtitleBar
          speaker="REACH"
          speakerColor="#10b981"
          text="“Done. The meeting minutes with all action item owners have been saved and opened on your laptop.”"
        />
      </Sequence>

      {/* SCENE 9 */}
      <Sequence from={2040} durationInFrames={270}>
        <VideoScene
          fileName="09_wake_up_clutch.mp4"
          shotTitle="09: The Clutch Delivery"
          description="Friend on laptop interrupts ('Are you awake?'). You jolt awake, look at screen, smile confidently, and read key points."
        />
        <SubtitleBar
          speaker="You"
          speakerColor="#38bdf8"
          text="“Got it right here: sprint deadline is Friday midnight, backend deployment wraps tomorrow, and all action items are assigned.”"
        />
      </Sequence>

      {/* SCENE 10 */}
      <Sequence from={2310} durationInFrames={180}>
        <VideoScene
          fileName="10_outro.mp4"
          shotTitle="10: REACH Outro"
          description="Smiling at camera, holding up phone, relaxed. (3-5 seconds)."
        />
        <OutroCard />
      </Sequence>
    </div>
  );
};
