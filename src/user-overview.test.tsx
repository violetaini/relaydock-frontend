import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserOverview, type OverviewData, type OverviewResource } from "./user-overview";

afterEach(() => cleanup());
const resource: OverviewResource = {kind:"server",id:1,name:"香港服务器",source:"manual",used:80,limit:100,reset:"每月 1 日重置",state:"active",related:false};
const base: OverviewData = {
 billed_bytes: 1024,activity:{connections:null,active_nodes:null,reporting_servers:0,expected_servers:2,complete:false,max_age_seconds:90},
 expiry:{kind:"package",id:2,name:"全球套餐",at:"2026-12-02T00:00:00Z",days:5,expired:false},
 limited_resources:1,unlimited_resources:1,near_limit:1,over_limit:0,unconfirmed:0,billing_resources:2,
 alerts:[{code:"quota_near",severity:"warn",kind:"server",id:1,name:"香港服务器",message:"已使用至少 80% 的额度，请留意剩余用量。",tab:"traffic"}],
 top_usage:[resource],
};
function show(overview: OverviewData | undefined = base, resources: OverviewResource[]=[resource]) {
 const onNavigate=vi.fn(),onSettings=vi.fn(),onAuthorize=vi.fn();
 render(<UserOverview user={{username:"alice",is_active:true,traffic_used:1024,package_name:"全球套餐",package_id:2}} overview={overview} resources={resources} asOf="2026-11-27T10:00:00Z" onNavigate={onNavigate} onSettings={onSettings} onAuthorize={onAuthorize}/>);
 return {onNavigate,onSettings,onAuthorize};
}
describe("single user key overview",()=>{
 it.each([1,2,3])("shows a separate quota breakdown only for multiple configured layers (%s)",count=>{
  const layers:NonNullable<OverviewData["quota_layers"]>=[
   {key:"package",title:"套餐总量",total:1,items:[{kind:"package",id:2,name:"全球套餐",used:90,limit:500}]},
   {key:"module",title:"模块额度",total:1,items:[{kind:"node",id:0,name:"节点模块",used:90,limit:100}]},
   {key:"resource",title:"单独资源",total:1,items:[{kind:"node",id:4,name:"日本节点",used:90,limit:100}]},
  ];
  show({...base,quota_layers:layers.slice(0,count)});
  if(count===1)expect(screen.queryByRole("region",{name:"分层用量"})).not.toBeInTheDocument();
  else{
   const region=screen.getByRole("region",{name:new RegExp("分层用量")});
   expect(within(region).getAllByRole("progressbar")).toHaveLength(count);
   expect(within(region).getByText("剩余 410 B")).toBeInTheDocument();
  }
 });
 it("does not label a child unlimited when an ancestor quota applies",()=>{
  show({...base,near_limit:0,limited_resources:1,top_usage:[{...resource,limit:0,limit_note:"受套餐总量额度约束"}]});
  expect(screen.getByText("受套餐总量额度约束")).toBeInTheDocument();
  expect(screen.getByLabelText("查看资源额度风险")).not.toHaveTextContent("不限额");
 });
 it("shows key metrics and ranked consumption without repeating resource cards",()=>{
  show();
  for(const label of ["计费用量","最近到期","当前连接","额度风险","主要用量来源","需要关注"])expect(screen.getByText(label,{exact:true})).toBeInTheDocument();
  expect(screen.queryByText("授权概览")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"查看 香港服务器 的用量"})).toBeInTheDocument();
  expect(document.querySelector(".um-resource-card")).toBeNull();
 });
 it("shows missing reports as unknown and explicit zero reports as zero",()=>{
  show();expect(screen.getByLabelText("当前连接情况")).toHaveTextContent("—");expect(screen.getByText("未收到近期连接上报")).toBeInTheDocument();
  cleanup();show({...base,activity:{...base.activity,connections:0,active_nodes:0,reporting_servers:2,complete:true}});
  expect(screen.getByLabelText("当前连接情况")).toHaveTextContent("0个");expect(screen.getByText("0 个节点活跃 · 2/2 台服务器已上报")).toBeInTheDocument();
 });
 it("does not display expired connection observations as current",()=>{
  show({...base,activity:{...base.activity,connections:9,active_nodes:2,reporting_servers:2,complete:true,reported_at:"2026-11-27T09:58:00Z"}});
  expect(screen.getByLabelText("当前连接情况")).toHaveTextContent("—");
  expect(screen.getByText("未收到近期连接上报")).toBeInTheDocument();
 });
 it("labels partial coverage and does not equate connections with devices",()=>{
  show({...base,activity:{...base.activity,connections:6,active_nodes:2,reporting_servers:1}});
  expect(screen.getByText("部分上报")).toBeInTheDocument();expect(screen.getByLabelText("当前连接情况")).toHaveTextContent("6个");
  expect(screen.getByText(/连接数不等于设备数/)).toBeInTheDocument();
 });
 it("navigates actionable quota and expiry alerts to the matching detail view",()=>{
  const {onNavigate}=show();
  fireEvent.click(screen.getByRole("button",{name:/香港服务器.*已使用至少/}));expect(onNavigate).toHaveBeenLastCalledWith("traffic","server");
  fireEvent.click(screen.getByRole("button",{name:"查看到期授权"}));expect(onNavigate).toHaveBeenLastCalledWith("resources");
 });
 it("keeps unknown receipts out of the failure list",()=>{
  show({...base,alerts:[],near_limit:0,unconfirmed:2});
  expect(screen.getByText("暂无已知异常")).toBeInTheDocument();expect(screen.getByText(/2 项授权状态待确认/)).toBeInTheDocument();
  expect(screen.queryByText("等待下发")).not.toBeInTheDocument();
 });
 it("does not claim unlimited service when no service exists",()=>{
  show({...base,expiry:null,alerts:[],near_limit:0,limited_resources:0,unlimited_resources:0,billing_resources:0,top_usage:[]},[]);
  expect(screen.getByText("暂无服务",{exact:true})).toBeInTheDocument();expect(screen.getByText("暂无可统计的计费资源")).toBeInTheDocument();expect(screen.queryByText("长期有效")).not.toBeInTheDocument();
 });
 it("offers all alerts on demand and sends account actions to settings",()=>{
  const alerts=Array.from({length:6},(_,i)=>({...base.alerts[0],id:i+1,name:`节点 ${i+1}`}));alerts[0]={...alerts[0],tab:"settings",name:"账号状态"};
  const {onSettings}=show({...base,alerts});
  expect(screen.queryByText("节点 6")).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"展开其余 2 项提醒"}));expect(screen.getByText("节点 6")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/账号状态.*已使用至少/}));expect(onSettings).toHaveBeenCalledOnce();
 });
});
