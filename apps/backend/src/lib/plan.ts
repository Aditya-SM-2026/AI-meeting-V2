import { callGeminiJson } from './gemini.js';

export interface CompetencyPlan {
    name: string;
    weight: number;
    probes: string[];
    anchorLow: string;
    anchorHigh: string;
}

export interface InterviewPlan {
    roleTitle: string;
    difficulty: 'easy' | 'medium' | 'hard';
    plannedDurationSec: number;
    competencies: CompetencyPlan[];
    fallback?: boolean;
}

export async function generatePlan(resumeText: string | null, jobDescription: string, roleHint?: string | null): Promise<InterviewPlan> {
    try {
        const plan = await callGeminiJson([
            `You design interview plans. From the job description and candidate resume, produce a JSON interview plan.`,
            ...(roleHint ? [`The role title is EXACTLY "${roleHint}" — use it as roleTitle verbatim.`] : []),
            `Respond with ONLY minified JSON:`,
            `{"roleTitle": "<3-6 word role title>", "difficulty": "<easy|medium|hard>",`,
            ` "competencies": [{"name": "<competency>", "weight": <0.0-1.0 relative importance>,`,
            `   "probes": ["<1-2 example interview questions probing this competency>"],`,
            `   "anchorLow": "<what a 1/5 answer sounds like>", "anchorHigh": "<what a 5/5 answer sounds like>"}]}`,
            `Give exactly 4-6 competencies. Weights should roughly sum to 1.0. Make competencies a mix of`,
            `role-specific technical skill, problem solving, communication, and genuine-experience checks.`,
            ``,
            `JOB DESCRIPTION:`,
            jobDescription.slice(0, 2500),
            ``,
            `CANDIDATE RESUME:`,
            (resumeText || '(not provided)').slice(0, 3000),
        ].join('\n'), 0.3);

        const competencies = Array.isArray(plan.competencies) ? plan.competencies.slice(0, 6).map((c: any) => ({
            name: String(c.name || 'Competency').slice(0, 60),
            weight: Math.min(1, Math.max(0, Number(c.weight) || 0.25)),
            probes: Array.isArray(c.probes) ? c.probes.map(String).slice(0, 3) : [],
            anchorLow: String(c.anchorLow || ''),
            anchorHigh: String(c.anchorHigh || ''),
        })) : [];

        if (competencies.length < 2) throw new Error('plan too small');

        const difficulty = ['easy', 'medium', 'hard'].includes(plan.difficulty) ? plan.difficulty : 'medium';
        const roleTitle = roleHint?.trim()
            ? roleHint.trim().slice(0, 80)
            : String(plan.roleTitle || 'Interview').slice(0, 80);
        return {
            roleTitle,
            difficulty,
            plannedDurationSec: 300,
            competencies,
        };
    } catch (err: any) {
        console.error('Plan generation failed, using fallback:', err?.message);
        return {
            roleTitle: roleHint?.trim()?.slice(0, 80) || 'Interview',
            difficulty: 'medium',
            plannedDurationSec: 300,
            fallback: true,
            competencies: [
                { name: 'Role fundamentals', weight: 0.3, probes: ['Core skills from the JD'], anchorLow: 'Vague, no specifics', anchorHigh: 'Specific, concrete examples' },
                { name: 'Problem solving', weight: 0.25, probes: ['A debugging or design scenario'], anchorLow: 'Jumps to answer without reasoning', anchorHigh: 'Structured reasoning with tradeoffs' },
                { name: 'Communication', weight: 0.2, probes: ['Explain a past project simply'], anchorLow: 'Disorganized, hard to follow', anchorHigh: 'Clear, organized, concise' },
                { name: 'Genuine experience', weight: 0.25, probes: ['Everyday details about claimed work'], anchorLow: 'Cannot describe daily specifics', anchorHigh: 'Rich, consistent real details' },
            ],
        };
    }
}