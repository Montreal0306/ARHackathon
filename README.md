# InSight: Real-Time Emotional Intelligence for Snap Spectacles
 
> *"Social subtitles for the real world."*
 
InSight is a passive AR assistant designed to help neurodivergent users understand social cues in real time, anchored directly to the world around them. By translating the "invisible" language of emotion into glanceable AR overlays, we provide a wearable accessibility tool for those who navigate the world differently.
 
---
 
## 🧠 The Problem: Access to Social Information
 
For millions, social cues are not automatically processed, leading to significant barriers in professional and personal life.
 
- **Prevalence:** 1 in 36 Americans are on the autism spectrum.
- **Identification:** 10% of people experience Alexithymia, the inability to identify emotions.
- **Workplace Failure:** 80% of autistic adults' failures in the workplace are social, not skill-based.
- **The Gap:** Current solutions like therapy or smartphone apps fail because they aren't available "in the moment" or require breaking eye contact to look at a screen.
 
---
 
## 💡 Our Solution: InSight
 
InSight is an AI-powered AR assistant that detects emotional subtext and floats subtle cues above a speaker's face.
 
- **Passive & Hands-Free:** No phone or complex HUD; just wear the glasses.
- **Spatially Anchored:** Visual cues move with the speaker's face, not your screen.
- **Nuanced Detection:** Powered by Hume AI to detect 53 emotional nuances beyond simple "happy" or "sad".
- **Incongruity Detection:** The first system to flag when a speaker's voice and face tell different stories (e.g., *"Voice: Joy · Face: Distress"*).
 
---
 
## 🛠️ Technical Architecture
 
Built for speed and the edge to ensure zero "dead time" during live conversations.
 
| Component | Technology | Role |
|---|---|---|
| Hardware | Snap Spectacles (2024) | AR display and microphone/camera capture |
| Backend | Convex WebSocket | Reactive engine for low-latency data routing |
| AI (Multimodal) | Hume AI Expression API | Analyzes 53 nuances from text and images |
| AI (Logic) | GPT-4o | Handles edge cases and synthesis of emotional data |
| Development | TypeScript / Lens Studio | Core application logic and AR experience design |
 
### The Pipeline
 
1. **Capture:** On-device ASR transcribes live speech from the Spectacles mic.
2. **Snapshot:** The world-facing camera captures the speaker's face per conversational turn.
3. **Route:** Convex routes text and images to Hume AI in parallel.
4. **Display:** Emoji and labels are spatially anchored above the speaker's head via Face Tracking.
5. **Failsafe:** If cloud processing exceeds 3 seconds, local Face Mesh blendshapes provide an instant "Quick Hint".
 
---
 
## 🌍 Impact Scenarios
 
- **Workforce:** An autistic professional in a meeting receives a *"Rising Friction"* warning, allowing them to navigate masked frustration.
- **Brain Health:** Users with Alexithymia receive early-warning stress pattern alerts to help self-regulate before reaching a sensory tipping point.
- **Daily Autonomy:** Visually impaired users receive audio-only cues when a conversation partner becomes disengaged (e.g., checking a watch).
 
