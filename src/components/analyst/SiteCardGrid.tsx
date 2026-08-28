import SiteCard from "./SiteCard";

export type SiteCardData = {
  id: string;
  name: string | null;
  siteAreaM2: number | null;
  createdAtLabel: string;
  analyzedAgoLabel: string;
  heatPhotoUrl: string | null;
  satellitePhotoUrl: string | null;
};

// Thin wrapper (project.md §5) — takes plain, already-fetched,
// serializable site data as props and owns only the responsive grid layout,
// not any data fetching of its own. No entrance animation on the grid or
// its cards (removed per follow-up request — cards render statically at
// their final position); SiteCard.tsx below is still a Client Component
// (it owns edit/delete state), but this grid itself no longer needs to be.
export default function SiteCardGrid({ sites }: { sites: SiteCardData[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {sites.map((site) => (
        <SiteCard
          key={site.id}
          id={site.id}
          name={site.name}
          siteAreaM2={site.siteAreaM2}
          createdAtLabel={site.createdAtLabel}
          analyzedAgoLabel={site.analyzedAgoLabel}
          heatPhotoUrl={site.heatPhotoUrl}
          satellitePhotoUrl={site.satellitePhotoUrl}
        />
      ))}
    </div>
  );
}
