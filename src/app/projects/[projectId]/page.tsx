import { ProjectDetailPage } from "@/features/projects/project-detail-page";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params;

  return <ProjectDetailPage projectId={projectId} />;
}
