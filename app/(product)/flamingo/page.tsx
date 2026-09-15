import Link from "../../components/NavigationLink";

export default function FlamingoPage() {
  return <div className="panel empty-panel" role="status">
    <h1 className="page-title">Flamingo Tool</h1>
    <p>This tool is planned for ResearchOps. Its workflow and connection will be added when the integration plan is ready.</p>
    <Link className="button" href="/projects">Back to Project Center</Link>
  </div>;
}
