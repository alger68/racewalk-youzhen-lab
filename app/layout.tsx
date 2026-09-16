import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "宥蓁競走動作分析 | RaceWalk Lab", description: "匯入影片，複查關鍵幀，追蹤每次競走訓練。", icons: {icon:"/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="zh-Hant"><body>{children}</body></html>}
