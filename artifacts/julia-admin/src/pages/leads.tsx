import { useState } from "react";
import { useListLeads, getListLeadsQueryKey, ListLeadsStatus, ListLeadsFunnelStage } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, AlertTriangle, MessageSquare } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce"; // Assuming this exists or I'll create a simple one or just not use debounce for now

// Simple debounce hook for local use
function useDebounceLocal<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  import("react").then(({ useEffect }) => {
    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
      return () => clearTimeout(handler);
    }, [value, delay]);
  });
  return debouncedValue;
}

export function StatusBadge({ status }: { status: string }) {
  let colorClass = "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
  
  if (status === 'hot') colorClass = "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
  else if (status === 'warm') colorClass = "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800";
  else if (status === 'cold') colorClass = "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  else if (status === 'closed') colorClass = "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  else if (status === 'lost') colorClass = "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";

  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider ${colorClass}`} data-testid={`status-badge-${status}`}>
      {status}
    </Badge>
  );
}

export default function Leads() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceLocal(search, 300);
  const [statusFilter, setStatusFilter] = useState<ListLeadsStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<ListLeadsFunnelStage | "all">("all");

  const queryParams: any = {};
  if (debouncedSearch) queryParams.search = debouncedSearch;
  if (statusFilter !== "all") queryParams.status = statusFilter;
  if (stageFilter !== "all") queryParams.funnelStage = stageFilter;

  const { data, isLoading } = useListLeads(queryParams, {
    query: { queryKey: getListLeadsQueryKey(queryParams) }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto pb-10 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and monitor dentist prospects.</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm flex flex-col flex-1 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row gap-4 items-center justify-between shrink-0">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search name, phone..."
              className="pl-9 bg-background h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-leads-search"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger className="w-full sm:w-[140px] h-9 bg-background" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="cold">Cold</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>

            <Select value={stageFilter} onValueChange={(v: any) => setStageFilter(v)}>
              <SelectTrigger className="w-full sm:w-[150px] h-9 bg-background" data-testid="select-stage-filter">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="interested">Interested</SelectItem>
                <SelectItem value="objection">Objection</SelectItem>
                <SelectItem value="closing">Closing</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-md">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase tracking-wider w-[250px]">Contact</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Stage</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Plan Interest</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Last Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-24 mt-2" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.leads && data.leads.length > 0 ? (
                data.leads.map((lead) => (
                  <TableRow key={lead.id} className="group hover:bg-muted/30 cursor-pointer transition-colors" data-testid={`lead-row-${lead.id}`}>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{lead.name || "Unknown Dentist"}</span>
                              {lead.handoffRequested && (
                                <AlertTriangle className="h-3 w-3 text-destructive" title="Handoff Requested" />
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">{lead.phone}</span>
                          </div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <span className="capitalize text-sm">{lead.funnelStage}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <StatusBadge status={lead.status} />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block">
                        <span className="text-sm text-muted-foreground capitalize">{lead.planInterest || "-"}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/leads/${lead.id}`} className="block">
                        <div className="flex items-center justify-end gap-2 text-muted-foreground text-xs font-mono">
                          {lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </div>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Filter className="h-10 w-10 mb-3 text-muted-foreground/30" />
                      <p className="text-lg font-medium text-foreground">No leads found</p>
                      <p className="text-sm">Try adjusting your filters or search query.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        {/* Simple Pagination Footer Placeholder */}
        <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between shrink-0 text-xs text-muted-foreground">
          <div>Showing {data?.leads?.length || 0} of {data?.total || 0} leads</div>
        </div>
      </div>
    </div>
  );
}