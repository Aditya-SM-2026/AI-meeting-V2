import 'dotenv/config';
import express from 'express'
import cors from "cors"
import interviewRouter from './routes/interview.js'
import interviewsRouter from './routes/interviews.js'
import recordingsRouter from './routes/recordings.js'

const app = express()
app.use(express.json())
app.use(cors())

app.get("/health", (req, res) => {
    res.send({ message: "hello from server" })
})

app.use("/api/v1", interviewRouter)
app.use("/api/v1/interviews", interviewsRouter)
app.use("/api/v1/recordings", express.raw({ type: () => true, limit: '10mb' }), recordingsRouter)

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log("server is up")
})