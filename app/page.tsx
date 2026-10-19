import { getSources } from '@/lib/sources';
import Feed from './feed';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const { sources, error } = await getSources();
  return <main>
    <header><a className="wordmark" href="/">SIGNAL<span>●</span></a><span className="tag">RESEARCH PILOT</span></header>
    <section className="hero"><p className="eyebrow">UK POLITICS · POLICY · RISK</p><h1>Follow the policy.<br/><em>Find the signal.</em></h1><p className="intro">Official energy and climate publications, brought into one searchable workspace. Start with the evidence.</p><div className="status"><span className={error ? 'dot' : 'dot live'}/>{error ? 'Source feed temporarily unavailable' : 'Connected to the source library'}</div></section>
    {error ? <section className="empty" role="alert"><h2>We couldn’t load the sources.</h2><p>The connection needs attention. Please try again shortly.</p><a className="retry" href="/">Try again ↗</a></section> : <Feed sources={sources} />}
    <footer><span>SIGNAL / Evidence before interpretation</span><a href="/api/health">Connection status ↗</a></footer>
  </main>;
}
