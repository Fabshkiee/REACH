# Demo assets

## `sample-meeting.mp3`

A **105-second synthetic product-sync recording** (four synthesised voices:
Alex, Samantha, Victoria, Fred). It is the input for the hero workflow:

> "Transcribe the product sync recording in my Downloads and write the meeting
> minutes to my laptop"

The meeting is about: a sync conflict resolver merged behind a flag, a
200-session threshold before it is trusted, an accessibility audit with seven
contrast and four focus-order findings, a staging database moving to a new
region on Friday night, and a pricing page that says "unlimited" when the
fair-use policy caps at 500GB.

REACH transcribes it with **Amazon Transcribe** (via S3 — the recording is
deleted from S3 afterwards), reasons over the transcript with **Bedrock**, and
writes a real `.docx` with attendees, decisions, action items **with owners**,
and open questions.

### Using it

```bash
cp assets/sample-meeting.mp3 ~/Downloads/product-sync-recording.mp3
```

Then, in the sim at <http://localhost:3000/sim>, type the goal above. REACH
will ask before it uploads the recording to a third-party service — that
approval card is part of the demo.

Everything in the recording is synthetic and says nothing about a real person,
company or product. It exists so the demo is reproducible from a clean clone
and so the minutes it produces can be checked against a known answer.
