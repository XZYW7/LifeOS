import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import TodayPage from '@/pages/TodayPage';
import ThreadsPage from '@/pages/ThreadsPage';
import ChatPage from '@/pages/ChatPage';
import TracePage from '@/pages/TracePage';
import SettingsPage from '@/pages/SettingsPage';
import CapturePage from '@/pages/CapturePage';
import AccessPanel from '@/components/settings/AccessPanel';

export default function App() {
  return (
    <Routes>
      {/* 移动端随手记：全屏独立页，不进桌面侧边导航 */}
      <Route path="/capture" element={<CapturePage />} />
      <Route element={<Layout />}>
        {/* / 就是今天页（首页入口已合并） */}
        <Route path="/" element={<TodayPage />} />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/trace" element={<TracePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* 手机访问入口：局域网地址 + 后端地址配置（后续可并入设置页） */}
        <Route path="/access" element={<AccessPanel />} />
        {/* 旧路由重定向：人生地图→线程，时间线/记忆库→轨迹，今日→/ */}
        <Route path="/map" element={<Navigate to="/threads" replace />} />
        <Route path="/timeline" element={<Navigate to="/trace" replace />} />
        <Route path="/memory" element={<Navigate to="/trace" replace />} />
        <Route path="/today" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
