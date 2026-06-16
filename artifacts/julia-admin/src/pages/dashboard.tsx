import { useGetDashboardStats, getGetDashboardStatsQueryKey, useGetFunnelStats, getGetFunnelStatsQueryKey, useGetRecentActivity, getGetRecentActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, UserX, Target, AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });
  
  const { data: funnel, isLoading: funnelLoading } = useGetFunnelStats({
    query: { queryKey: getGetFunnelStatsQueryKey() }
  });

  const { data: activity, isLoading: activityLoading } = useGetRecentActivity(
    { limit: 10 },
    { query: { queryKey: getGetRecentActivityQueryKey({ limit: 10 }) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time overview of Júlia's operations.</p>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Leads" 
          value={stats?.totalLeads} 
          isLoading={statsLoading} 
          icon={Users} 
          description="All time" 
          testId="stat-total-leads"
        />
        <StatCard 
          title="Hot Leads" 
          value={stats?.hotLeads} 
          isLoading={statsLoading} 
          icon={Target} 
          description="High intent" 
          highlight="text-orange-500"
          testId="stat-hot-leads"
        />
        <StatCard 
          title="Conversion Rate" 
          value={stats ? `${stats.conversionRate.toFixed(1)}%` : undefined} 
          isLoading={statsLoading} 
          icon={UserCheck} 
          description="Closed / Total" 
          highlight="text-green-500"
          testId="stat-conversion"
        />
        <StatCard 
          title="Handoffs Pending" 
          value={stats?.handoffsPending} 
          isLoading={statsLoading} 
          icon={AlertTriangle} 
          description="Requires human action" 
          highlight={stats?.handoffsPending ? "text-red-500" : "text-muted-foreground"}
          testId="stat-handoffs"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funnel Chart */}
        <Card className="lg:col-span-2 shadow-sm border-border">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
              <ArrowRight size={16} className="text-primary" />
              Funnel Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {funnelLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-10 w-full rounded-sm" />
                ))}
              </div>
            ) : funnel && funnel.length > 0 ? (
              <div className="space-y-4">
                {funnel.map((stage, idx) => {
                  const maxCount = Math.max(...funnel.map(f => f.count), 1);
                  const percentage = Math.max((stage.count / maxCount) * 100, 2);
                  return (
                    <div key={stage.stage} className="flex items-center gap-4" data-testid={`funnel-stage-${stage.stage}`}>
                      <div className="w-24 text-sm font-medium text-muted-foreground capitalize shrink-0 text-right">
                        {stage.stage}
                      </div>
                      <div className="flex-1 h-8 bg-muted rounded-sm overflow-hidden relative group">
                        <div 
                          className="h-full bg-primary transition-all duration-1000 ease-out group-hover:bg-primary/90" 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="w-12 text-sm font-bold font-mono text-right shrink-0">
                        {stage.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground text-sm border border-dashed rounded-md">
                No funnel data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="shadow-sm border-border">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="text-base font-semibold font-mono flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
                {activity.map((item, i) => (
                  <Link 
                    key={`${item.leadId}-${i}`} 
                    href={`/leads/${item.leadId}`}
                    className="block hover:bg-muted/50 p-4 transition-colors"
                    data-testid={`activity-item-${item.leadId}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <UserCheck size={14} />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-tight">
                          {item.leadName || item.phone}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.event} &middot; <span className="capitalize">{item.funnelStage}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 font-mono">
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">
                No recent activity
              </div>
            )}
            <div className="p-3 border-t border-border/50 text-center">
              <Link href="/leads" className="text-xs text-primary hover:underline font-medium uppercase tracking-wider" data-testid="link-view-all-leads">
                View All Leads
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  isLoading, 
  icon: Icon, 
  description,
  highlight,
  testId
}: { 
  title: string; 
  value?: string | number | null; 
  isLoading: boolean; 
  icon: any; 
  description?: string;
  highlight?: string;
  testId?: string;
}) {
  return (
    <Card className="shadow-sm border-border" data-testid={testId}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
          <Icon className={`h-4 w-4 ${highlight || 'text-muted-foreground'}`} />
        </div>
        <div className="flex flex-col gap-1">
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-3xl font-bold font-mono tracking-tight">{value !== undefined && value !== null ? value : '-'}</div>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}