const API_KEY = process.env.API_KEY;
const TEXT_MODEL = 'gemini-3.1-flash-lite'
export async function generateInterviewSummary(transcript: any){
    if (!API_KEY) throw new Error('GEMINI_API_KEY is not set');
    
    const transcriptText = transcript.transcript
    .map((t: any) => `${t.role === 'User' ? 'User' : 'Assistance'}: ${t.message}`)
    .join('\n');

  const prompt = [
    `Below is the transc  ript of a voice interview of the candidate.`,
    `Write a concise hiring-panel summary covering: strengths, weaknesses, communication quality,`,
    `and a final recommendation (Strong Hire / Hire / No Hire / Strong No Hire).`,
    `Then on a new final line output exactly: "SCORE: X" where X is an integer 0-10.`,
    ``,
    `Transcript:`,
    transcriptText || '(empty transcript)',
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini summary request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p : any) => p.text).join('') || '';

  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch ? Math.min(10, Math.max(0, parseInt(scoreMatch[1], 10))) : null;

  return { summary: text, score };
}

export async function callGeminiJson(prompt: string, temperature = 0.2, model: string = TEXT_MODEL): Promise<any> {
  if (!API_KEY) throw new Error('API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  });

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2500 * attempt));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (res.status === 503 || res.status === 429) {
      lastErr = new Error(`Gemini request failed (${res.status}): ${await res.text()}`);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Gemini request failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    const jsonText = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    return JSON.parse(jsonText);
  }
  throw lastErr || new Error('Gemini request failed');
}

export interface VideoPerformanceAnalysis {
  score: number | null;
  summary: string;
  metrics: Record<string, number>;
  observations: { frame: number; note: string }[];
}

export interface IntegrityReport {
  aiProbability: number;
  verdict: string;
  executiveSummary: string;
  performanceSummary: string;
  strengths: string[];
  weaknesses: string[];
  evidence: { source: string; quote: string; reason: string; weight: string }[];
  consistencyChecks: { originalQuestion: string; originalAnswer: string; revisitQuestion: string; revisitAnswer: string; consistent: boolean }[];
  recommendation: string;
}

interface IntegrityInput {
  transcript: { type: string; message: string; createdAt?: Date | string }[];
  sessionMetrics?: any;
  videoFeedback?: any;
  resumeText?: string | null;
  jobDescription?: string | null;
}

export async function generateIntegrityReport(input: IntegrityInput): Promise<IntegrityReport> {
  if (!API_KEY) throw new Error('API_KEY is not set');

  const transcriptText = input.transcript
    .slice(0, 120)
    .map((t: any) => `${t.type === 'User' ? 'CANDIDATE' : 'INTERVIEWER'}: ${String(t.message).slice(0, 600)}`)
    .join('\n')
    .slice(0, 16000);

  const prompt = [
    `You are an interview-integrity analyst. A voice interview was conducted by an AI interviewer`,
    `whose protocol deliberately mixed technical, common-sense and personal-preference questions,`,
    `revisited earlier answers in reworded form, and fired surprise "off-script" probes when an`,
    `answer looked rehearsed. Your job: estimate the probability that the candidate was getting`,
    `real-time help from an AI tool (second screen, phone, earpiece, answer-reading).`,
    ``,
    `SESSION METRICS (recorded by the server; latency = seconds between interviewer finishing a question and candidate speech starting):`,
    JSON.stringify(input.sessionMetrics || {}, null, 1).slice(0, 2000),
    ``,
    `VIDEO OBSERVATIONS (sampled webcam frames, assessed post-session):`,
    JSON.stringify(input.videoFeedback || null, null, 1).slice(0, 2000),
    ``,
    `CANDIDATE RESUME (for grounding, may be truncated):`,
    (input.resumeText || '(none)').slice(0, 3000),
    ``,
    `JOB DESCRIPTION:`,
    (input.jobDescription || '(none)').slice(0, 2000),
    ``,
    `FULL TRANSCRIPT (CANDIDATE = candidate speech, INTERVIEWER = AI interviewer speech):`,
    transcriptText || '(empty)',
    ``,
    `Signals to weigh (positive = suggests AI assistance):`,
    `- Response latencies suspiciously short and uniform across many turns.`,
    `- Answers that start instantly with essay-like, over-polished, filler-free structure unlike natural speech.`,
    `- Verbatim or near-verbatim reuse of phrasing across differently-worded revisits (sign of reading from a stored answer).`,
    `- Failure or long hesitation on surprise common-sense probes, especially ones related to the candidate's claimed expertise.`,
    `- Contradictions between original answers and revisits.`,
    `- Answers that ignore the actual question asked (reading a prepared answer regardless of the question).`,
    `- Video: gaze consistently off-camera toward a fixed second point, reading posture.`,
    `Counter-signals (suggest genuine): natural fillers/self-corrections, varied latency, consistent revisits, quick correct probe answers, natural conversational flow.`,
    `Judge holistically. Do not penalize nervousness alone; do not reward fluency alone.`,
    ``,
    `Respond with ONLY minified JSON, no markdown fences, exactly this shape:`,
    `{"aiProbability": <integer 0-100, probability candidate used real-time AI assistance>,`,
    ` "verdict": "<Likely genuine | Suspicious | Likely AI-assisted>",`,
    ` "executiveSummary": "<3-4 sentences for the recruiter>",`,
    ` "performanceSummary": "<3-4 sentences on interview performance, independent of integrity>",`,
    ` "strengths": ["..."], "weaknesses": ["..."],`,
    ` "evidence": [{"source": "<transcript|timing|video|probe|consistency>", "quote": "<verbatim quote or metric>", "reason": "<why this is suspicious or genuine>", "weight": "<high|medium|low>"}],`,
    ` "consistencyChecks": [{"originalQuestion": "...", "originalAnswer": "...", "revisitQuestion": "...", "revisitAnswer": "...", "consistent": <bool>}],`,
    ` "recommendation": "<Proceed to next round | Hold — verify in person | Reject>"}`,
    `Give 4-10 evidence items. Include at least one genuine/counter-signal item if any exist. If the transcript is too short to judge, set aiProbability to 50 and say so in the summary.`,
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini integrity request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';

  const jsonText = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const parsed = JSON.parse(jsonText);

  const clampPct = (v: any) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));

  return {
    aiProbability: clampPct(parsed.aiProbability),
    verdict: String(parsed.verdict || 'Suspicious'),
    executiveSummary: String(parsed.executiveSummary || ''),
    performanceSummary: String(parsed.performanceSummary || ''),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 8) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String).slice(0, 8) : [],
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.slice(0, 12).map((e: any) => ({
          source: String(e.source || 'transcript'),
          quote: String(e.quote || ''),
          reason: String(e.reason || ''),
          weight: String(e.weight || 'medium'),
        }))
      : [],
    consistencyChecks: Array.isArray(parsed.consistencyChecks)
      ? parsed.consistencyChecks.slice(0, 8).map((c: any) => ({
          originalQuestion: String(c.originalQuestion || ''),
          originalAnswer: String(c.originalAnswer || ''),
          revisitQuestion: String(c.revisitQuestion || ''),
          revisitAnswer: String(c.revisitAnswer || ''),
          consistent: Boolean(c.consistent),
        }))
      : [],
    recommendation: String(parsed.recommendation || 'Hold — verify in person'),
  };
}

export interface VideoBehaviorSignal {
  at: number;
  type: string;
  note: string;
}

export interface VideoPerformanceAnalysis {
  score: number | null;
  summary: string;
  metrics: Record<string, number>;
  signals: VideoBehaviorSignal[];
  observations: { frame: number; note: string }[];
}

function formatAt(sec?: number): string {
  if (sec === undefined || Number.isNaN(sec)) return 'unknown time';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function analyzeVideoPerformance(
  frames: { data: string; at?: number }[]
): Promise<VideoPerformanceAnalysis> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const prompt = [
    `You are a behavioral analyst reviewing webcam footage of a candidate during a REMOTE VOICE interview.`,
    `The candidate could cheat by reading answers aloud from an AI tool on a phone or second screen kept off-camera.`,
    `You are given ${frames.length} frames sampled from their webcam over the session, each labeled with its timestamp.`,
    ``,
    `Look for these behavioral patterns ACROSS frames (use the timestamps to reason about duration and repetition):`,
    `- GAZE: looking at camera vs consistently off to ONE side (a fixed off-camera point is the classic second-screen signature),`,
    `  or rapid left-right scanning typical of reading text.`,
    `- READING: eyes moving in scan patterns, lips pressed/moving as if reading, long frozen posture.`,
    `- PRESENCE: face missing from frame, candidate leaving repeatedly, face turned away, someone else visible, a phone held up,`,
    `  a bright screen glow reflecting on the face in a dark room.`,
    `- POSTURE: unnaturally rigid and static vs natural micro-movements; sudden posture changes when challenged.`,
    `- ENGAGEMENT: facial expressiveness matching a live conversation vs flat/distracted.`,
    `- PROFESSIONALISM: setting and appearance appropriate for a job interview.`,
    `Ignore webcam/image quality. One person on camera looking natural at a desk is the GOOD case.`,
    `Do not over-flag: brief glance-aways are normal human behavior; only sustained or repeated patterns matter.`,
    ``,
    `Respond with ONLY minified JSON, no markdown fences, exactly this shape:`,
    `{"score": <integer 0-10 overall on-camera behavior>, "summary": "<2-3 sentence behavioral assessment>",`,
    ` "metrics": {"eyeContact": <0-10>, "gazeStability": <0-10, how steady the gaze direction is toward the camera>,`,
    `             "posture": <0-10>, "engagement": <0-10>, "professionalism": <0-10>, "presence": <0-10, stayed visible and attentive>},`,
    ` "signals": [{"at": <seconds timestamp of the behavior>, "type": "<gaze|reading|presence|posture|engagement|environment>", "note": "<one concrete sentence>"}],`,
    ` "observations": [{"frame": <1-based frame index>, "note": "<short concrete observation>"}]}`,
    `Give 3-8 signals covering the whole timeline (early, middle, late). If no person is visible in any frame, set score to 0`,
    `and explain in the summary.`,
  ].join('\n');

  const parts: any[] = [{ text: prompt }];
  frames.forEach((frame, i) => {
    parts.push({ text: `Frame ${i + 1} at ${formatAt(frame.at)}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: frame.data } });
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini video analysis request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';

  const jsonText = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const parsed = JSON.parse(jsonText);

  const clamp = (v: any) => Math.min(10, Math.max(0, Math.round(Number(v) || 0)));

  return {
    score: parsed.score === null || parsed.score === undefined ? null : clamp(parsed.score),
    summary: String(parsed.summary || ''),
    metrics: parsed.metrics && typeof parsed.metrics === 'object'
      ? Object.fromEntries(Object.entries(parsed.metrics).map(([k, v]) => [k, clamp(v)]))
      : {},
    signals: Array.isArray(parsed.signals)
      ? parsed.signals.slice(0, 10).map((s: any) => ({
          at: Number(s.at) || 0,
          type: String(s.type || 'behavior'),
          note: String(s.note || ''),
        }))
      : [],
    observations: Array.isArray(parsed.observations)
      ? parsed.observations.slice(0, 8).map((o: any) => ({
          frame: Number(o.frame) || 0,
          note: String(o.note || ''),
        }))
      : [],
  };
}