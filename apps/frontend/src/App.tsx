import './App.css'
import {BrowserRouter, Route, Routes} from "react-router-dom"
import { Home } from './Pages/Home'
import { Room } from './Pages/Room'
import { Report } from './Pages/Report'


function App() {
  return (
    <BrowserRouter>
		<Routes>
			<Route path='/' element={<Home/>} />
			<Route path='/home' element={<Home/>} />
			<Route path='/room/:token' element={<Room/>} />
			<Route path='/report/:interviewId' element={<Report/>} />
		</Routes>
    </BrowserRouter>
  )
}

export default App