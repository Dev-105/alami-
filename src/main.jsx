import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { ClientView, AdminView, Login } from "./App";

function App() {
  return <Routes><Route path="/" element={<ClientView />} /><Route path="/admin" element={<AdminView />} /><Route path="/admin/login" element={<Login />} /><Route path="/admin/barber" element={<AdminView />} /><Route path="/admin/owner" element={<AdminView />} /></Routes>;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>,
);
