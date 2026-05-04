import React, { useState, useEffect } from 'react';
import { fetchIncidents, fetchSignals, updateIncidentStatus, submitRCA } from './api';
import { Activity, AlertTriangle, CheckCircle, Clock, ShieldAlert, X, ChevronRight, Server } from 'lucide-react';
import { format } from 'date-fns';

export default function App() {
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);

  // RCA Form State
  const [rcaForm, setRcaForm] = useState({ root_cause: 'Database Timeout', fix_applied: '', prevention: '' });

  const loadIncidents = async () => {
    try {
      const { data } = await fetchIncidents();
      setIncidents(data);
    } catch (err) {
      console.error("Failed to fetch incidents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
    const interval = setInterval(loadIncidents, 5000); // Polling for Hot-Path Cache
    return () => clearInterval(interval);
  }, []);

  const openIncident = async (incident) => {
    setSelectedIncident(incident);
    const { data } = await fetchSignals(incident.id);
    setSignals(data);
  };

  const handleStatusChange = async (newStatus) => {
    await updateIncidentStatus(selectedIncident.id, newStatus);
    setSelectedIncident({ ...selectedIncident, status: newStatus });
    loadIncidents();
  };

  const handleRCASubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await submitRCA(selectedIncident.id, rcaForm);
      setSelectedIncident(data.incident);
      loadIncidents();
      alert(`Incident Closed! MTTR: ${data.mttr_minutes} minutes.`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to close incident');
    }
  };

  const getSeverityColor = (sev) => sev === 'P0' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  const getStatusColor = (status) => {
    switch(status) {
      case 'OPEN': return 'text-red-400';
      case 'INVESTIGATING': return 'text-yellow-400';
      case 'RESOLVED': return 'text-blue-400';
      case 'CLOSED': return 'text-slate-500';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="min-h-screen flex bg-brand-dark overflow-hidden font-sans">
      
      {/* Sidebar Navigation */}
      <nav className="w-20 border-r border-slate-800 flex flex-col items-center py-6 bg-brand-card z-10">
        <div className="p-3 bg-brand-accent/20 rounded-xl mb-8">
          <Activity className="text-brand-accent w-6 h-6" />
        </div>
        <div className="space-y-6 text-slate-500">
          <ShieldAlert className="w-6 h-6 hover:text-slate-300 cursor-pointer transition-colors" />
          <Server className="w-6 h-6 hover:text-slate-300 cursor-pointer transition-colors" />
          <Clock className="w-6 h-6 hover:text-slate-300 cursor-pointer transition-colors" />
        </div>
      </nav>

      {/* Main Dashboard Feed */}
      <main className="flex-1 flex flex-col h-screen relative">
        <header className="h-20 border-b border-slate-800 flex items-center px-10 bg-brand-dark/50 backdrop-blur-md">
          <h1 className="text-2xl font-bold tracking-tight text-white">Mission Control</h1>
          <div className="ml-auto flex items-center space-x-4 text-sm font-medium text-slate-400">
            <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span> System Healthy</span>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-10">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-lg font-semibold text-slate-300 mb-6 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-yellow-500" /> Active Triage Queue
            </h2>
            
            {loading ? (
              <div className="animate-pulse flex space-x-4"><div className="h-12 bg-slate-800 rounded w-full"></div></div>
            ) : (
              <div className="bg-brand-card border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500 bg-slate-900/50">
                      <th className="p-5 font-medium">Incident ID</th>
                      <th className="p-5 font-medium">Component</th>
                      <th className="p-5 font-medium">Severity</th>
                      <th className="p-5 font-medium">Status</th>
                      <th className="p-5 font-medium">Time Logged</th>
                      <th className="p-5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {incidents.map((inc) => (
                      <tr 
                        key={inc.id} 
                        onClick={() => openIncident(inc)}
                        className="hover:bg-slate-800/30 cursor-pointer transition-colors group"
                      >
                        <td className="p-5 text-slate-300 font-mono text-sm">#{inc.id.toString().padStart(4, '0')}</td>
                        <td className="p-5 font-medium text-slate-200">{inc.component_id}</td>
                        <td className="p-5">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(inc.severity)}`}>
                            {inc.severity}
                          </span>
                        </td>
                        <td className="p-5">
                          <span className={`font-semibold text-sm flex items-center ${getStatusColor(inc.status)}`}>
                            {inc.status === 'CLOSED' && <CheckCircle className="w-4 h-4 mr-1.5" />}
                            {inc.status}
                          </span>
                        </td>
                        <td className="p-5 text-slate-500 text-sm">{format(new Date(inc.created_at), 'MMM dd, HH:mm:ss')}</td>
                        <td className="p-5 text-right">
                          <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-brand-accent transition-colors ml-auto" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Slide-over Incident Details & RCA Modal */}
      {selectedIncident && (
        <aside className="w-[600px] bg-brand-card border-l border-slate-800 shadow-2xl flex flex-col h-screen absolute right-0 top-0 transform transition-transform animate-in slide-in-from-right">
          <div className="h-20 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50">
            <div>
              <p className="text-xs font-mono text-brand-accent mb-1">INCIDENT #{selectedIncident.id}</p>
              <h2 className="text-xl font-bold text-white">{selectedIncident.component_id}</h2>
            </div>
            <button onClick={() => setSelectedIncident(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-8">
            
            {/* Status Controls */}
            {selectedIncident.status !== 'CLOSED' && (
              <div className="p-5 bg-slate-900 rounded-xl border border-slate-800">
                <h3 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Update Status</h3>
                <div className="flex space-x-3">
                  {['OPEN', 'INVESTIGATING', 'RESOLVED'].map(s => (
                    <button 
                      key={s} onClick={() => handleStatusChange(s)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedIncident.status === s ? 'bg-brand-accent text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* RCA Form (Only shows if not closed) */}
            {selectedIncident.status !== 'CLOSED' ? (
              <form onSubmit={handleRCASubmit} className="space-y-5 bg-slate-900 p-6 rounded-xl border border-slate-800">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2">Mandatory RCA</h3>
                
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Root Cause Category</label>
                  <select 
                    className="w-full bg-brand-dark border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent outline-none"
                    value={rcaForm.root_cause} onChange={e => setRcaForm({...rcaForm, root_cause: e.target.value})}
                  >
                    <option>Database Timeout</option>
                    <option>Memory Leak</option>
                    <option>Network Partition</option>
                    <option>Code Deployment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Fix Applied</label>
                  <textarea 
                    required className="w-full bg-brand-dark border border-slate-700 rounded-lg p-3 text-slate-200 h-24 focus:border-brand-accent outline-none"
                    placeholder="Describe the immediate mitigation..."
                    value={rcaForm.fix_applied} onChange={e => setRcaForm({...rcaForm, fix_applied: e.target.value})}
                  />
                </div>

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg transition-colors flex justify-center items-center">
                  <CheckCircle className="w-5 h-5 mr-2" /> Submit RCA & Close Incident
                </button>
              </form>
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-xl">
                <h3 className="text-emerald-400 font-semibold mb-2 flex items-center"><CheckCircle className="w-5 h-5 mr-2"/> RCA Submitted & Closed</h3>
                <p className="text-sm text-slate-300"><span className="font-medium">Root Cause:</span> {selectedIncident.rca_payload?.root_cause}</p>
                <p className="text-sm text-slate-300 mt-2"><span className="font-medium">Fix:</span> {selectedIncident.rca_payload?.fix_applied}</p>
              </div>
            )}

            {/* Audit Log (Raw Signals from MongoDB) */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Raw Signal Audit Log ({signals.length})</h3>
              <div className="space-y-3">
                {signals.map((sig, idx) => (
                  <div key={idx} className="bg-slate-900 border border-slate-800 p-4 rounded-lg font-mono text-xs">
                    <div className="flex justify-between text-slate-500 mb-2">
                      <span>Signal Received</span>
                      <span>{format(new Date(sig.timestamp), 'HH:mm:ss.SSS')}</span>
                    </div>
                    <pre className="text-brand-accent overflow-x-auto">
                      {JSON.stringify(sig.payload, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </aside>
      )}
    </div>
  );
} 