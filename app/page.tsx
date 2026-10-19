import { checkDatabase } from '@/lib/health';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const database = await checkDatabase();
  return <main>
    <header><a className="wordmark" href="/">SIGNAL<span>●</span></a><span className="tag">PROJECT FOUNDATION</span></header>
    <section className="hero"><p className="eyebrow">UK POLITICS · POLICY · RISK</p><h1>Clarity in a<br/><em>changing landscape.</em></h1><p className="intro">A research workspace for understanding political developments, tracing the evidence, and exploring what comes next.</p><div className="status"><span className={database.ok ? 'dot live' : 'dot'}/>{database.ok ? 'Research foundation online' : 'Connection check needs attention'}</div></section>
    <section className="grid" aria-label="Planned research capabilities">
      <article><span className="number">01 / COLLECT</span><h2>Follow the evidence.</h2><p>A foundation for bringing official publications and policy developments into one research workspace.</p><small>Planned</small></article>
      <article><span className="number">02 / UNDERSTAND</span><h2>Connect the context.</h2><p>Source-grounded analysis designed to separate documented evidence from interpretation.</p><small>Planned</small></article>
      <article><span className="number">03 / ASSESS</span><h2>Explore the implications.</h2><p>Structured political-risk briefings with clear assumptions, citations and uncertainty.</p><small>Planned</small></article>
    </section>
    <footer><span>SIGNAL / Early development</span><a href="/api/health">Check connection ↗</a></footer>
  </main>;
}
