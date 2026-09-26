import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Radar from "./pages/Radar";
import ProblemDetail from "./pages/ProblemDetail";
import Profile from "./pages/Profile";
import FinanceLayout from "./pages/finance/FinanceLayout";
import Transactions from "./pages/finance/Transactions";
import FinanceStats from "./pages/finance/Stats";
import Budgets from "./pages/finance/Budgets";
import AddTransactions from "./pages/finance/Add";
import FinanceSettings from "./pages/finance/Settings";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="radar" element={<Radar />} />
              <Route path="radar/:id" element={<ProblemDetail />} />
              <Route path="finance" element={<FinanceLayout />}>
                <Route index element={<Transactions />} />
                <Route path="stats" element={<FinanceStats />} />
                <Route path="budgets" element={<Budgets />} />
                <Route path="add" element={<AddTransactions />} />
                <Route path="settings" element={<FinanceSettings />} />
              </Route>
              <Route path="profile" element={<Profile />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
