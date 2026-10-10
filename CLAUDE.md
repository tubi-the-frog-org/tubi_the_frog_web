# Tubi the Wizard Frog: Website Brief

## How I'd like to work
Before writing any code, let's talk. Read this, then tell me how you'd approach it, what you'd change in my thinking, and what you need to know from me. Ask as many questions as you like and push back where my ideas are weak. Once we agree on a plan, propose a small first step and build from there, checking in as we go.

Everything below is context and current thinking, not orders. The **constraints** are real. The **suggestions** are just my best guess, so improve on them.

## The project
**Tubi** is an animatronic wizard frog **snack dispenser**. Customers talk to him, he figures out which snack suits them, and he dispenses it. This is for a **hackathon**, so speed and demo reliability matter more than elegance.

**The work is split between two people:**
- **My teammate** handles all the AI logic (deciding what Tubi says and which snack to give), all voice output (Tubi's speech), and all the physical components (animatronics, speaker, dispenser).
- **I'm building the website,** and that includes **speech-to-text**. The site's job:
  1. **Activate the frog** when a customer arrives.
  2. **Collect the customer's microphone input** from their phone.
  3. **Turn their speech into text** (that's my job, not my teammate's).
  4. **Send the text to my teammate's system** as simple JSON.
  5. **Display things on the phone** when my teammate's system asks for it, such as a Rorschach-style inkblot test or the final snack result.

The site does **not** run the AI, generate Tubi's voice, or control the frog's hardware. It's the phone-side front door: the customer's ears and eyes, plus the transcription.

## The experience
1. A customer taps their phone on an **NFC sticker** on the machine. It opens our URL in their browser.
2. If someone else is already using the frog, they see a "busy" screen. Otherwise they see an **"Awaken the Wizard"** button.
3. Tapping it activates the frog (tells my teammate's system a session has started), asks for **mic permission**, and starts listening.
4. What the customer says is transcribed and sent to my teammate's system as text. Tubi replies out of the **frog's own speaker**, which my teammate handles, not the site.
5. When the AI wants to show something, like an inkblot or the chosen snack, it tells the site and the site displays it.
6. The session ends and the frog is free for the next person.

## Constraints (these are real)
- **One person at a time.** The frog is a physical object, so only one phone can control it at once. The server must own this rule; the client shouldn't be trusted to decide. Think about phones that lock, refresh, or drop Wi-Fi mid-session, since the lock must never get stuck.
- **Phone's native mic** through the browser. No native app.
- **HTTPS is required** for mic access outside localhost.
- **Mic must start from a user tap** (iOS Safari rule), hence the deliberate "Awaken" button.
- **Cost and abuse protection:** sessions should have a time cap (I was thinking about 3 minutes or x amount of time since last input) so a stuck session can't tie up the frog or run up API bills, including any speech-to-text service I use.
- **Secrets stay on the server.** Nothing sensitive in client code or the repo. If I use a paid speech-to-text API, the key must not reach the browser (a short-lived token minted by the server is one option).

## Tech stack (my current thinking, open to discussion)
- **Frontend:** Vite + React + TypeScript, mobile-first
- **Server:** Node + Express + `ws` (WebSockets)
- **One process** serving both the built web app and the WebSocket
- **State:** in memory, no database (state can reset on restart)
- **Tests:** Vitest, especially for the lock logic
- **Speech-to-text:** undecided (see the next section)
- **Hosting (later):** Render Web Service, Starter plan, one instance. I'm not paying for hosting until the app is built, so for now it needs to run locally. Make sure `npm install && npm run build && npm start` works, since that's what the host will run.

**Why a live server:** we need long-lived WebSockets, shared in-memory lock state, a safe place for API keys, and somewhere to sit between the phone and my teammate's system. That rules out serverless platforms (Vercel, Netlify, Lambda), and it means running exactly one instance so the in-memory lock stays in one place.

If you'd choose something simpler or more robust, say so.

## Open question 1: how to do speech-to-text
This is a big decision, and I haven't made it. Options as I see them:

- **Browser built-in (Web Speech API).** Free, no server work, and it gives live text. But support is uneven (iOS Safari is the worry), it may send audio to Apple or Google, and accuracy and stability vary. Quickest to try, riskiest to depend on.
- **Cloud streaming STT** (for example Deepgram, AssemblyAI, ElevenLabs, Fish Audio, OpenAI, Google). The phone streams audio to a service and gets text back. Better accuracy and consistent across devices, but it costs money, adds latency, needs an API key handled safely, and adds a dependency that could fail during the demo.
- **Self-hosted model** (for example Whisper). No per-use cost or third party, but it needs a machine with enough power and more setup.
- **A hybrid:** one primary approach with a fallback (for example cloud STT, falling back to the browser's built-in, falling back to typed text).

Things I'd like to think through with you:
- **Turn-taking:** how do we know the customer has finished speaking? Voice-activity detection, a pause timer, or push-to-talk?
- **Interim vs final text:** do we send partial transcripts as the user speaks, or only the finished sentence?
- **Echo:** the phone mic will hear Tubi's own voice from the frog's speaker, and it could get transcribed as if the customer said it. One idea is for my teammate's system to tell the site when Tubi is speaking, so the site pauses transcription. I'd like your opinion.
- **Latency:** the conversation should feel fast, so what's a realistic target?

## Open question 2: the interface with my teammate
This is a contract between me and my teammate, so it should be simple, stable, and documented. Since I'm sending **text**, it can be small. A rough idea:

**Site → teammate:** session started, session ended, and transcripts (the text, whether it's final or partial, and maybe a timestamp or confidence score).

**Teammate → site:** show an inkblot (an id or seed, so the blot is reproducible) or hide it, show text on screen, show the final result (the snack), end the session, and perhaps "Tubi is speaking" and "Tubi stopped speaking" so the site can handle echo.

**Connection:** should the phone's data go to *our* server, which relays it to my teammate? Or straight to them? My instinct is to have **my teammate's system connect outbound to our server** (our server sits in the middle, holds the lock, and relays), because it avoids firewall and NAT headaches if their code runs on a laptop at the venue. I'd like your opinion.

I'd like to design a small, clear message format together, then hand it to my teammate.

## Display features
- **Inkblot test:** I'd suggest generating inkblots on the phone's canvas procedurally (random blobs on one half, mirrored, blurred, and thresholded), seeded so the same id always renders the same blot. That way my teammate only has to send a short id. Open to alternatives, like pre-made images.
- **Result screen:** shows the chosen snack with some animation. The snack list is a placeholder for now and will come from my teammate.
- **Themed UI:** mystical wizard-frog vibe, mobile portrait first, large tap targets.

## Development without my teammate
I don't want to be blocked waiting on their system. I'd like a **fake backend** for development that:
- shows the transcripts it receives, so I can confirm mic capture and speech-to-text work, and
- lets me manually trigger display commands (show inkblot, show result, "Tubi is speaking," end session).

That way the whole phone-side flow can be built and tested alone. Suggest how you'd do it.

## Known gotchas
- **Echo** (see above), plus a push-to-talk fallback is probably wise.
- **Screen sleep:** the phone shouldn't lock mid-session (Wake Lock API).
- **Venue Wi-Fi** may be flaky, so reconnection and a hotspot backup matter. Cloud STT makes this matter more.
- **Noisy venue:** a hackathon floor is loud, which hurts transcription. Noise suppression and a good "I didn't catch that" path matter.
- **Idle proxies** can drop quiet WebSocket connections, so heartbeats are needed.
- **Failure fallbacks:** if speech-to-text fails or my teammate's system goes down, the site should say so politely and not crash. A typed-text fallback is worth building.
- **Admin escape hatch:** something like a secret reset endpoint that force-frees the lock during a live demo.
- **Stable NFC URL:** whatever URL goes on the sticker shouldn't need to change, so I'll likely buy a domain.
- **Deploys drop live connections**, so no pushing code during the demo.

## Open questions I'd love your take on
1. Which speech-to-text approach would you pick for a hackathon demo, and why?
2. How would you handle turn-taking and echo?
3. How would you structure the single-user lock and reconnection (and what edge cases am I missing)?
4. Is routing everything through our server the right call, or is there something simpler?
5. What should we build and verify first to de-risk the project?
6. Anything in this brief that seems wrong, risky, or over-engineered?

## What I'd like from you first
Not code. Give me:
1. A short summary of how you understand the project.
2. Your questions for me.
3. Your proposed plan and first step, including anything you'd change in my thinking.