import { getSources, getSourceFeeds } from '@/lib/sources';
import Feed from './feed';
import ImportStatus from './import-status';
import { getImportStatus } from '@/lib/import-status';
import { getPublishedReviews } from '@/lib/events';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const [{ sources, error }, imports, feeds, reviews] = await Promise.all([getSources(), getImportStatus(), getSourceFeeds(), getPublishedReviews()]);
  return <main>
    <header><a className="wordmark" href="/">SIGNAL<span>●</span></a><a className="tag" href="/review">EDITOR SIGN-IN</a></header>
    <section className="hero"><p className="eyebrow">UK POLITICS · POLICY · RISK</p><h1>Follow the policy.<br/><em>Find the signal.</em></h1><p className="intro">Official UK government publications and parliamentary statements, brought into one searchable workspace. Start with the evidence.</p><div className="status"><span className={error ? 'dot' : 'dot live'}/>{error ? 'Source feed temporarily unavailable' : 'Connected to the source library'}</div></section>
    <section className="featured-event" aria-label="First worked analysis"><div><p className="eyebrow">FROM SOURCE TO IMPACT · WORKED EXAMPLE 01</p><h2>Clean Heat: higher targets, wider flexibility</h2><p>Follow a proposed policy change through its evidence, economic mechanisms and potential sector exposure.</p></div><a href="/events/clean-heat-2027">Explore the analysis →</a></section>
    <ImportStatus data={imports} />
    {!!reviews.length && <section className="feed-discovery" aria-label="Editor-reviewed policy records"><p className="eyebrow">EDITOR-REVIEWED POLICY RECORDS</p>{reviews.map(r => <div key={r.slug}><h2><a href={`/events/${r.slug}`}>{r.title} →</a></h2><p>Event date: {r.event_date} · manually reviewed</p></div>)}</section>}
    <section className="feed-discovery" aria-label="Publication feeds"><p className="eyebrow">PUBLICATION DISCOVERY</p>
      {feeds.error ? <p>Publication feed details are temporarily unavailable.</p> : feeds.feeds.map(feed => <div key={feed.id}><h2><a href={feed.url} target="_blank" rel="noreferrer">{feed.name} ↗</a></h2><p>The daily refresh checks the newest {feed.per_run_limit} entries. Newly discovered documents join the library and remain on the refresh list.</p></div>)}
      <p className="scope-note">This is a bounded recent-publication feed, not a complete historical archive. The pilot monitors at most 100 documents. Follow the feed link for the full list.</p>
    </section>
    {error ? <section className="empty" role="alert"><h2>We couldn’t load the sources.</h2><p>The connection needs attention. Please try again shortly.</p><a className="retry" href="/">Try again ↗</a></section> : <Feed sources={sources} failures={imports.latest?.failures || []} />}
    <footer><span>SIGNAL / Evidence before interpretation</span><a href="/api/health">Connection status ↗</a></footer>
  </main>;
}
