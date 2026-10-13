import 'dotenv/config';
import express from 'express'
import cors from "cors"
import interviewRouter from './routes/interview.js'
import interviewsRouter from './routes/interviews.js'

const app = express()
app.use(express.json())
app.use(cors())
app.use(express.text({ type: ["application/sdp", "text/plain"] }));

app.get("/health", (req, res) => {
    res.send({ message: "hello from server" })
})

app.use("/api/v1", interviewRouter)
app.use("/api/v1/interviews", interviewsRouter)

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log("server is up")
})