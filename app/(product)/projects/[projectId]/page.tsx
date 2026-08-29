import type { Metadata } from "next";
import { ProjectDetail } from "../../../components/ProjectDetail";

export const metadata: Metadata = { title: "Project details" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} />;
}
