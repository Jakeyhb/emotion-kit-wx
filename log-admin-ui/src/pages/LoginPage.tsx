import { useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { setJwt } from "../auth";

export default function LoginPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; token?: string; errMsg?: string };
      if (!r.ok || !j.ok || !j.token) {
        message.error(j.errMsg || `登录失败 HTTP ${r.status}`);
        return;
      }
      setJwt(j.token);
      message.success("登录成功");
      nav("/", { replace: true });
    } catch (e) {
      message.error((e as Error).message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "linear-gradient(160deg, #0d1117 0%, #161b22 100%)",
      }}
    >
      <Card style={{ width: 400, maxWidth: "100%" }} title="emotion-kit-ai 管理后台">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          超级管理员由服务端初始化：环境变量 <Typography.Text code>ADMIN_BOOTSTRAP=1</Typography.Text>（也支持{" "}
          <Typography.Text code>true</Typography.Text>）且 <Typography.Text code>admin_users</Typography.Text>{" "}
          为空时，会创建 <Typography.Text code>admin</Typography.Text> /{" "}
          <Typography.Text code>admin</Typography.Text>。若库里已有 admin 但密码不对，可临时同时设置{" "}
          <Typography.Text code>ADMIN_BOOTSTRAP_RESET_ADMIN=1</Typography.Text>
          后重启服务一次以重置为默认密码，然后立刻删掉上述变量并改密。
        </Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ username: "admin", password: "admin" }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input prefix={<UserOutlined />} placeholder="admin" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
