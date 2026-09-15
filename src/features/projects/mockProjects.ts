import type { Project } from "./project.types";

export const projects: Project[] = [
  { id: "PRJ-1048", name: "Digital Wallet Adoption", client: "Northstar Bank", clientPo: "NB-44028", market: "India", type: "Consumer", manager: "Raghav Mehta", status: "LIVE", starts: 1248, reached: 1084, l24: 93, completes: 468, terminates: 462, overQuota: 87, qualityTerm: 67, abandonRate: 8.4, incidenceRate: 43.2, conversionRate: 37.5, cpi: 8.5, lastComplete: "3 min ago" },
  { id: "PRJ-1047", name: "Enterprise Cloud Pulse", client: "Arc Technologies", clientPo: "ARC-8821", market: "United States", type: "B2B", manager: "Maya Shah", status: "LIVE", starts: 842, reached: 731, l24: 61, completes: 294, terminates: 308, overQuota: 52, qualityTerm: 34, abandonRate: 6.8, incidenceRate: 40.2, conversionRate: 34.9, cpi: 21, lastComplete: "7 min ago" },
  { id: "PRJ-1046", name: "Premium Beauty Habits", client: "Halo Consumer", clientPo: "HC-01942", market: "United Kingdom", type: "Consumer", manager: "Anika Rao", status: "PAUSED", starts: 615, reached: 580, l24: 0, completes: 205, terminates: 249, overQuota: 74, qualityTerm: 22, abandonRate: 7.1, incidenceRate: 35.3, conversionRate: 33.3, cpi: 10.75, lastComplete: "Yesterday" },
  { id: "PRJ-1045", name: "Mobility Futures 2026", client: "Aperture Auto", clientPo: "AA-76392", market: "Germany", type: "Consumer", manager: "Raghav Mehta", status: "LIVE", starts: 1031, reached: 914, l24: 78, completes: 391, terminates: 361, overQuota: 91, qualityTerm: 38, abandonRate: 7.4, incidenceRate: 42.8, conversionRate: 37.9, cpi: 12.2, lastComplete: "12 min ago" },
  { id: "PRJ-1044", name: "Q3 Grocery Tracker", client: "Field & Fork", clientPo: "FF-33008", market: "Canada", type: "Tracker", manager: "Maya Shah", status: "PENDING", starts: 0, reached: 0, l24: 0, completes: 0, terminates: 0, overQuota: 0, qualityTerm: 0, abandonRate: 0, incidenceRate: 0, conversionRate: 0, cpi: 7.9, lastComplete: "Not started" },
  { id: "PRJ-1043", name: "Streaming Experience Study", client: "Mosaic Media", clientPo: "MM-28011", market: "Australia", type: "Consumer", manager: "Anika Rao", status: "LIVE", starts: 719, reached: 651, l24: 42, completes: 286, terminates: 246, overQuota: 54, qualityTerm: 25, abandonRate: 5.5, incidenceRate: 43.9, conversionRate: 39.8, cpi: 9.4, lastComplete: "18 min ago" },
  { id: "PRJ-1042", name: "SME Lending Landscape", client: "Northstar Bank", clientPo: "NB-43892", market: "Singapore", type: "B2B", manager: "Raghav Mehta", status: "CLOSED", starts: 922, reached: 801, l24: 0, completes: 350, terminates: 319, overQuota: 77, qualityTerm: 38, abandonRate: 6.4, incidenceRate: 43.7, conversionRate: 38, cpi: 24.5, lastComplete: "Aug 11" },
  { id: "PRJ-1041", name: "Home Energy Decisions", client: "Evergreen Energy", clientPo: "EE-10073", market: "United States", type: "Consumer", manager: "Maya Shah", status: "PENDING", starts: 0, reached: 0, l24: 0, completes: 0, terminates: 0, overQuota: 0, qualityTerm: 0, abandonRate: 0, incidenceRate: 0, conversionRate: 0, cpi: 11.25, lastComplete: "Not started" },
];

const demoDetails = [
  { clientCode: "NB", marketCountryCode: "IN", quota: 999, createdAt: "2026-09-12T09:00:00Z", updatedAt: "2026-09-14T08:00:00Z", secondaryManager: "Maya Shah", salesPerson: "Priya Shah" },
  { clientCode: "ARC", marketCountryCode: "US", quota: 999, createdAt: "2026-09-11T09:00:00Z", updatedAt: "2026-09-13T08:00:00Z", secondaryManager: "Raghav Mehta", salesPerson: "Kabir Rao" },
  { clientCode: "HC", marketCountryCode: "GB", quota: 500, createdAt: "2026-09-10T09:00:00Z", updatedAt: "2026-09-12T08:00:00Z", salesPerson: "Priya Shah" },
  { clientCode: "AA", marketCountryCode: "DE", quota: 700, createdAt: "2026-09-09T09:00:00Z", updatedAt: "2026-09-11T08:00:00Z", salesPerson: "Kabir Rao" },
  { clientCode: "FF", marketCountryCode: "CA", quota: 100, createdAt: "2026-09-08T09:00:00Z", updatedAt: "2026-09-10T08:00:00Z" },
  { clientCode: "MM", marketCountryCode: "AU", quota: 600, createdAt: "2026-09-07T09:00:00Z", updatedAt: "2026-09-09T08:00:00Z", salesPerson: "Priya Shah" },
  { clientCode: "NB", marketCountryCode: "SG", quota: 500, createdAt: "2026-09-06T09:00:00Z", updatedAt: "2026-09-08T08:00:00Z", salesPerson: "Kabir Rao" },
  { clientCode: "EE", marketCountryCode: "US", quota: 100, createdAt: "2026-09-05T09:00:00Z", updatedAt: "2026-09-07T08:00:00Z" },
];
projects.forEach((project, index) => Object.assign(project, demoDetails[index]));

export const suppliers = [
  { name: "CPX Research", started: 410, reached: 361, complete: 158, terminate: 139, quota: 39, quality: 18, ir: 43.8, cpi: 8.2, cost: 1295.6 },
  { name: "BitLabs", started: 362, reached: 318, complete: 137, terminate: 128, quota: 32, quality: 12, ir: 43.1, cpi: 8.8, cost: 1205.6 },
  { name: "PureSpectrum", started: 476, reached: 405, complete: 173, terminate: 195, quota: 16, quality: 37, ir: 42.7, cpi: 8.5, cost: 1470.5 },
];
