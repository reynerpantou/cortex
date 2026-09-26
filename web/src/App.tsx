import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Radar from "./pages/Radar";
import ProblemDetail from "./pages/ProblemDetail";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import RequireAccess from "./components/RequireAccess";
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
              <Route element={<RequireAccess module="radar" />}>
                <Route path="radar" element={<Radar />} />
                <Route path="radar/:id" element={<ProblemDetail />} />
              </Route>
              <Route element={<RequireAccess module="finance" />}>
                <Route path="finance" element={<FinanceLayout />}>
                  <Route index element={<Transactions />} />
                  <Route path="stats" element={<FinanceStats />} />
                  <Route path="budgets" element={<Budgets />} />
                  <Route path="add" element={<AddTransactions />} />
                  <Route path="settings" element={<FinanceSettings />} />
                </Route>
              </Route>
              <Route element={<RequireAccess admin />}>
                <Route path="admin" element={<Admin />} />
              </Route>
              <Route path="profile" element={<Profile />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
