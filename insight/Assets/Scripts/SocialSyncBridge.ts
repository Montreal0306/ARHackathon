import {ASRQueryController} from "./ASRQueryController"
import {Promisfy} from "RemoteServiceGateway.lspkg/Utils/Promisfy"
import {setTimeout} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils"

/**
 * Connects ASR + world-facing Camera to the Convex SocialSync backend.
 *
 * Flow per ASR turn:
 *  1. User pinches mic button -> ASR listens
 *  2. ASR finalizes transcript (of whoever is speaking — mic is on the glasses)
 *  3. World-facing camera captures one frame (of the OTHER person's face)
 *  4. POSTs { transcript, faceImageBase64 } to Convex
 *  5. Convex calls Hume (language model on text + face model on image)
 *  6. Convex compares language vs face emotions, detects incongruity
 *  7. Returns { hint, label } -> displayed on hintText
 */
@component
export class SocialSyncBridge extends BaseScriptComponent {
  @ui.separator
  @ui.label("SocialSync — Convex endpoint")

  @input
  @hint("Full URL: https://YOUR_DEPLOYMENT.convex.site/socialsync/ingest")
  private convexIngestUrl: string = ""

  @ui.separator
  @ui.label("Wiring")

  @input
  @allowUndefined
  @hint("Leave empty if on same object as ASRQueryController")
  private asrController: ASRQueryController

  @input
  @allowUndefined
  @hint("Drag the Text COMPONENT (not SceneObject) where hints should appear")
  private hintText: Text

  @ui.separator
  @ui.label("Options")

  @input
  @hint("Send camera frame for Hume face analysis (uses credits)")
  private enableFaceCapture: boolean = true

  @input
  @hint("Auto-clear hint after N seconds (0 = keep)")
  private hintTtlSec: number = 10

  @input
  private debugLog: boolean = true

  private internetModule: InternetModule = require("LensStudio:InternetModule") as InternetModule
  private cameraModule = require("LensStudio:CameraModule") as CameraModule
  private cameraTexture: Texture
  private clearToken: number = 0
  private hintTextResolved: Text | null = null

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init() {
    // Resolve hintText — try direct input first, then search children
    this.hintTextResolved = this.hintText ?? null
    if (!this.hintTextResolved) {
      this.log("hintText not wired via Inspector — hints will only appear in Logger.")
    } else {
      this.log("hintText wired OK.")
      this.hintTextResolved.text = "SocialSync ready"
    }

    // Setup world-facing camera for face capture
    if (this.enableFaceCapture) {
      try {
        const req = CameraModule.createCameraRequest()
        req.cameraId = CameraModule.CameraId.Default_Color
        this.cameraTexture = this.cameraModule.requestCamera(req)
        this.log("World-facing camera initialized for face capture.")
      } catch (e) {
        this.log(`Camera init failed: ${e} — will send text only.`)
        this.enableFaceCapture = false
      }
    }

    // Wire ASR
    let asr = this.asrController
    if (!asr) {
      asr = this.sceneObject.getComponent(
        ASRQueryController.getTypeName()
      ) as ASRQueryController
    }
    if (!asr) {
      this.log("ERROR: No ASRQueryController found — wire it or place script on VoiceInput.")
      this.showHint("ERROR: ASR not found")
      return
    }

    asr.onQueryEvent.add((transcript: string) => {
      this.log(`ASR transcript: "${transcript}"`)
      this.onTranscript(transcript)
    })
    this.log("Listening for ASR transcripts. Pinch mic to start.")
  }

  private log(msg: string) {
    if (this.debugLog) print(`[SocialSync] ${msg}`)
  }

  private onTranscript(transcript: string) {
    const trimmed = (transcript ?? "").trim()
    if (!trimmed) return

    const url = (this.convexIngestUrl ?? "").trim()
    if (!url) {
      this.log("convexIngestUrl is empty — set it in Inspector.")
      this.showHint("Set Convex URL in Inspector")
      return
    }

    if (this.enableFaceCapture && this.cameraTexture) {
      this.captureAndSend(trimmed, url)
    } else {
      this.sendToConvex(trimmed, url, undefined)
    }
  }

  private captureAndSend(transcript: string, url: string) {
    Base64.encodeTextureAsync(
      this.cameraTexture,
      (base64Image: string) => {
        this.log(`Frame captured (${Math.round(base64Image.length / 1024)}KB)`)
        this.sendToConvex(transcript, url, base64Image)
      },
      () => {
        this.log("Frame encode failed — sending text only.")
        this.sendToConvex(transcript, url, undefined)
      },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }

  private sendToConvex(transcript: string, url: string, faceImageBase64: string | undefined) {
    const payload: {transcript: string; faceImageBase64?: string} = { transcript }
    if (faceImageBase64) {
      payload.faceImageBase64 = faceImageBase64
    }

    const request = RemoteServiceHttpRequest.create()
    request.url = url
    request.method = RemoteServiceHttpRequest.HttpRequestMethod.Post
    request.body = JSON.stringify(payload)
    request.contentType = "application/json"

    this.log(`POST ${url} (face: ${faceImageBase64 ? "yes" : "no"})`)
    this.showHint("Analyzing...")

    Promisfy.InternetModule.performHttpRequest(this.internetModule, request)
      .then((response) => {
        const code = response.statusCode
        const body = response.body ?? ""
        this.log(`Response ${code}: ${body.substring(0, 200)}`)

        if (code !== 200) {
          this.showHint(`Server error (${code})`)
          return
        }

        try {
          const data = JSON.parse(body) as {
            hint?: string
            label?: string | null
            topLanguageEmotion?: string | null
            topFaceEmotion?: string | null
            incongruity?: boolean
          }
          const parts: string[] = []
          if (data.label) parts.push(`[${data.label}]`)
          if (data.hint) parts.push(data.hint)
          const display = parts.join(" ") || "No hint"
          this.log(`Display: ${display}`)
          this.showHint(display)
        } catch {
          this.log(`Bad JSON: ${body}`)
          this.showHint("Parse error")
        }
      })
      .catch((err) => {
        this.log(`Request failed: ${err}`)
        this.showHint("Network error")
      })
  }

  private showHint(message: string) {
    this.log(`HINT -> "${message}"`)
    if (this.hintTextResolved) {
      this.hintTextResolved.text = message
    } else {
      this.log("(hintText not wired — hint only in Logger)")
    }
    if (this.hintTtlSec <= 0) return
    const token = ++this.clearToken
    setTimeout(() => {
      if (token !== this.clearToken) return
      if (this.hintTextResolved) this.hintTextResolved.text = ""
    }, this.hintTtlSec)
  }
}
