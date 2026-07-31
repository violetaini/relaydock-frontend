export type Theme = "light" | "dark";

export type NginxMode = "managed" | "reuse_existing";

export interface Session {
  token: string;
  expires_at: string;
  username: string;
  email: string;
  nickname: string;
  avatar_url: string;
  role: string;
  is_admin: boolean;
}

export interface Profile {
  username: string;
  email: string;
  nickname: string;
  avatar_url: string;
  role: string;
  is_admin: boolean;
}

export interface RemoteServer {
  id: number;
  name: string;
  status: string;
  last_heartbeat?: string;
  ip_address?: string;
  ip_address_v6?: string;
  ipv6_enabled: boolean;
  domain?: string;
  connection_mode: string;
  listen_port?: number;
  current_upload_speed: number;
  current_download_speed: number;
  xray_running: boolean;
  xray_version?: string;
  xray_mode: string;
  nginx_mode?: NginxMode;
  traffic_limit: number;
  traffic_used: number;
  traffic_stats_mode: string;
  traffic_source: string;
  country_code?: string;
  cpu_pct?: number;
  loadavg?: string;
  mem_used?: number;
  mem_total?: number;
  disk_used?: number;
  disk_total?: number;
  ws_connected: boolean;
  fallback_to_pull?: boolean;
  encrypted: boolean;
  agent_uninstall_v2?: boolean;
  warp_installed?: boolean;
  is_federated?: boolean;
  federation_prefix?: string;
  inbounds: Array<{
    tag: string;
    protocol: string;
    port: number;
    uplink: number;
    downlink: number;
  }>;
}

export interface NodeItem {
  id: number;
  node_name: string;
  protocol: string;
  raw_url: string;
  clash_config: string;
  parsed_config: string;
  enabled: boolean;
  tag: string;
  tags?: string[];
  original_server: string;
  inbound_tag: string;
  node_type: string;
  routed_owner?: string;
  created_by?: string;
  relay_orig_server?: string;
  relay_orig_port?: number;
  updated_at: string;
}

export interface UserItem {
  username: string;
  email: string;
  nickname: string;
  role: string;
  is_active: boolean;
  remark: string;
  package_id?: number;
  package_name?: string;
  traffic_used: number;
  traffic_limit: number;
  traffic_limit_gb?: number;
  traffic_limit_override_gb?: number | null;
  is_over_limit: boolean;
  speed_limit_mbps: number;
  device_limit: number;
  package_end_date?: string;
}

export interface PackageItem {
  id: number;
  name: string;
  description: string;
  traffic_limit_gb: number;
  cycle_days: number;
  is_reset: boolean;
  reset_day: number;
  nodes: number[];
  speed_limit_mbps: number;
  device_limit: number;
  short_code: string;
  traffic_mode: string;
  node_multipliers?: Record<string, number>;
  node_speed_limits?: Record<string, number>;
  node_device_limits?: Record<string, number>;
  auto_speed_rules?: AutoSpeedLimitRule[];
  template_filename?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AutoSpeedLimitRule {
  type: "sustained" | "burst" | string;
  threshold_mbps: number;
  sustained_seconds: number;
  window_seconds: number;
  burst_count: number;
  limit_mbps: number;
  limit_duration: number;
}

export interface TrafficSummary {
  metrics: {
    total_limit_gb: number;
    total_used_gb: number;
    total_remaining_gb: number;
    usage_percentage: number;
    unlimited_used_gb: number;
  };
  history: Array<{ date: string; used_gb: number }> | null;
}

export interface ServerListResponse {
  success: boolean;
  message?: string;
  servers?: RemoteServer[];
}

export interface NodeListResponse {
  nodes: NodeItem[];
}

export interface RealtimeMessage {
  type: string;
  servers?: RemoteServer[];
  serverId?: number;
  services?: {
    success?: boolean;
    xray?: { installed: boolean; running: boolean; version?: string };
    nginx?: { installed: boolean; running: boolean; version?: string };
  };
  userConnections?: Record<string, number>;
  trafficSummary?: TrafficSummary;
}

export interface TunnelInfo {
  kind: "inbound" | "routed";
  server_id: number;
  server_name: string;
  is_federated: boolean;
  tag: string;
  listen_port: number;
  target_address: string;
  target_port: number;
  network: string;
  inbound_tag?: string;
  match_domain?: string[];
  match_ip?: string[];
  rule_index?: number;
}

export interface TunnelHop {
  server_id: number;
  server_name: string;
  tag: string;
  listen_port: number;
  target_address: string;
  target_port: number;
}

export interface TunnelChain {
  id?: string;
  label: string;
  hops: TunnelHop[];
  entry_server: number;
  entry_port: number;
  final_target: string;
}

export interface TunnelsResponse {
  success: boolean;
  tunnels: TunnelInfo[] | null;
  chains: TunnelChain[] | null;
}

export interface SharedServerToken {
  id: number;
  server_id: number;
  label: string;
  created_at: string;
  revoked_at?: string;
}

export interface SpeedTester {
  id: number;
  name: string;
  created_by: string;
  last_seen?: string;
  created_at: string;
  online: boolean;
}

export interface SpeedTestResult {
  id: number;
  node_id: number;
  node_name: string;
  source: "master_local" | "home_tester";
  down_mbps: number;
  latency_ms: number;
  test_bytes: number;
  status: "running" | "ok" | "failed";
  error?: string;
  egress_ip?: string;
  tested_by: string;
  created_at: string;
}
