import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Layout,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useNavigate } from "react-router-dom";
import { clearJwt, getJwt } from "../auth";

const { Header, Content } = Layout;

type LogRow = {
  id: number;
  created_at: string;
  phase: string;
  level: string;
  meta_json: unknown;
};

type ListResponse = {
  ok: boolean;
  errMsg?: string;
  mysql?: boolean;
  rows?: LogRow[];
  total?: number;
  page?: number;
  pageSize?: number;
};

function formatMeta(meta: unknown): string {
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

export default function LogsPage() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [phase, setPhase] = useState("");
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [mysql, setMysql] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const t = getJwt().trim();
    if (!t) {
      message.warning("未登录");
      nav("/login", { replace: true });
      return;
    }
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", String(pageSize));
      if (phase.trim()) q.set("phase", phase.trim());
      if (range && range[0]) q.set("from", range[0].toISOString());
      if (range && range[1]) q.set("to", range[1].toISOString());
      const r = await fetch(`/api/logs?${q.toString()}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const j = (await r.json()) as ListResponse;
      if (!r.ok || !j.ok) {
        message.error(j.errMsg || `加载失败 HTTP ${r.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(j.rows || []);
      setTotal(j.total ?? 0);
      setMysql(!!j.mysql);
    } catch (e) {
      message.error((e as Error).message || String(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, phase, range, nav]);

  const loadRef = useRef(load);
  loadRef.current = load;

  const loadMeta = useCallback(async () => {
    const t = getJwt().trim();
    if (!t) return;
    try {
      const r = await fetch("/api/logs/meta", { headers: { Authorization: `Bearer ${t}` } });
      const j = (await r.json()) as { ok?: boolean; mysql?: boolean };
      if (r.ok && j.mysql != null) setMysql(!!j.mysql);
    } catch {
      setMysql(null);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadRef.current();
  }, [page, pageSize]);

  const columns: ColumnsType<LogRow> = [
    { title: "id", dataIndex: "id", width: 90, fixed: "left" },
    {
      title: "时间",
      dataIndex: "created_at",
      width: 200,
      render: (v) => (v != null ? String(v) : ""),
    },
    {
      title: "phase",
      dataIndex: "phase",
      width: 160,
      render: (v) => <Tag color="blue">{v}</Tag>,
    },
    { title: "level", dataIndex: "level", width: 100 },
    {
      title: "meta",
      dataIndex: "meta_json",
      ellipsis: true,
      render: (v) => (
        <Typography.Paragraph
          copyable
          style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 560 }}
        >
          {formatMeta(v)}
        </Typography.Paragraph>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh", background: "#0d1117" }}>
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          padding: "0 24px",
        }}
      >
        <Typography.Title level={4} style={{ margin: 0, color: "#e6edf3" }}>
          emotion-kit-ai 日志
        </Typography.Title>
        <Space>
          {mysql === false && <Tag color="red">MySQL 未就绪</Tag>}
          {mysql === true && <Tag color="green">MySQL 已连接</Tag>}
          <Button
            onClick={() => {
              clearJwt();
              nav("/login", { replace: true });
            }}
          >
            退出
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="phase 包含"
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <DatePicker.RangePicker
            showTime
            value={range}
            onChange={(v) => setRange(v)}
          />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
        <Table<LogRow>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps || 50);
            },
          }}
        />
      </Content>
    </Layout>
  );
}
