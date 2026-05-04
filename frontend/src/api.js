import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:5000/api',
});

export const fetchIncidents = () => API.get('/work-items');
export const fetchSignals = (id) => API.get(`/work-items/${id}/signals`);
export const updateIncidentStatus = (id, status) => API.patch(`/work-items/${id}/status`, { status });
export const submitRCA = (id, rca_payload) => API.patch(`/work-items/${id}/rca`, { rca_payload });