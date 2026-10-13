import z, { string } from 'zod'

export const PreInterviewSchema = z.object({
    github: z.string(),
    linkedin: z.string() 
})

export const VideoAnalysisSchema = z.object({
    interviewId: z.string(),
    frames: z.array(
        z.object({
            data: z.string(),
            at: z.number().optional()
        })
    ).min(1).max(30)
})