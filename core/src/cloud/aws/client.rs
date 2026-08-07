use anyhow::{anyhow, Result};
use std::time::SystemTime;

/// Credentials and region used to sign AWS query-API requests.
#[derive(Debug, Clone)]
pub struct AwsSession {
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
    pub session_token: String,
}

impl Default for AwsSession {
    fn default() -> Self {
        Self {
            region: "us-east-1".to_string(),
            access_key: String::new(),
            secret_key: String::new(),
            session_token: String::new(),
        }
    }
}

/// Shared AWS query-API client. Builds `https://{endpoint}/?{params}`, signs each
/// request with SigV4 via the shared signer, and returns the raw XML response body.
pub(crate) struct AwsClient {
    client: reqwest::Client,
    session: AwsSession,
}

impl AwsClient {
    /// Build a client from the standard AWS environment variables. The region defaults
    /// to us-east-1 and missing credentials are left empty so construction never fails.
    pub fn from_env() -> Result<Self> {
        let session = AwsSession {
            region: std::env::var("AWS_REGION")
                .or_else(|_| std::env::var("AWS_DEFAULT_REGION"))
                .unwrap_or_else(|_| "us-east-1".to_string()),
            access_key: std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_default(),
            secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_default(),
            session_token: std::env::var("AWS_SESSION_TOKEN").unwrap_or_default(),
        };
        Ok(Self::new(session))
    }

    pub fn new(session: AwsSession) -> Self {
        Self {
            client: reqwest::Client::new(),
            session,
        }
    }

    pub fn region(&self) -> &str {
        &self.session.region
    }

    /// Run a query-API call against `endpoint` (e.g. `ec2.us-east-1.amazonaws.com`)
    /// signed for the client's configured region.
    pub async fn query(&self, endpoint: &str, service: &str, params: &[(&str, &str)]) -> Result<String> {
        self.query_in_region(endpoint, service, &self.session.region, params)
            .await
    }

    /// Run a query-API call signed for an explicit region. Used for cross-region
    /// operations such as copying a snapshot to a target region.
    pub async fn query_in_region(
        &self,
        endpoint: &str,
        service: &str,
        region: &str,
        params: &[(&str, &str)],
    ) -> Result<String> {
        let url = build_query_url(endpoint, params)?;
        let headers = sign_get_headers(&url, service, region, &self.session)?;
        let mut req = self.client.get(&url);
        for (key, value) in &headers {
            req = req.header(key, value);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            if let Some(detail) = extract_error_message(&body) {
                anyhow::bail!("AWS {service} request to {url} failed: {status} {detail}");
            }
            anyhow::bail!("AWS {service} request to {url} failed: {status} {body}");
        }
        Ok(body)
    }
}

/// Build `https://{endpoint}/?<urlencoded, sorted params>`.
fn build_query_url(endpoint: &str, params: &[(&str, &str)]) -> Result<String> {
    let mut sorted: Vec<(&str, &str)> = params.to_vec();
    sorted.sort_unstable();
    let mut url = reqwest::Url::parse(&format!("https://{endpoint}/"))
        .map_err(|e| anyhow!("failed to parse AWS endpoint {endpoint}: {e}"))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in &sorted {
            query.append_pair(key, value);
        }
    }
    Ok(url.to_string())
}

/// Pull the human-readable message out of an AWS `ErrorResponse` XML body.
fn extract_error_message(body: &str) -> Option<String> {
    let root = parse_xml_tree(body).ok()?;
    if root.name != "ErrorResponse" {
        return None;
    }
    let error = root.child("Error")?;
    let message = error.text_of_child("Message");
    if message.is_empty() {
        return None;
    }
    let code = error.text_of_child("Code");
    Some(if code.is_empty() {
        message
    } else {
        format!("[{code}] {message}")
    })
}

/// Sign a GET request with AWS SigV4 and return the headers to attach to it.
pub(crate) fn sign_get_headers(
    url: &str,
    service: &str,
    region: &str,
    session: &AwsSession,
) -> Result<Vec<(String, String)>> {
    sign_get_headers_at(url, service, region, session, SystemTime::now())
}

pub(crate) fn sign_get_headers_at(
    url: &str,
    service: &str,
    region: &str,
    session: &AwsSession,
    time: SystemTime,
) -> Result<Vec<(String, String)>> {
    use aws_credential_types::Credentials;
    use aws_sigv4::http_request::{
        sign as sign_http, SignableBody, SignableRequest, SigningParams, SigningSettings,
    };
    use aws_sigv4::sign::v4;

    let session_token = if session.session_token.is_empty() {
        None
    } else {
        Some(session.session_token.clone())
    };
    let identity = Credentials::new(
        session.access_key.clone(),
        session.secret_key.clone(),
        session_token,
        None,
        "bck",
    )
    .into();

    let params = v4::SigningParams::builder()
        .identity(&identity)
        .region(region)
        .name(service)
        .time(time)
        .settings(SigningSettings::default())
        .build()
        .map_err(|e| anyhow!("failed to build SigV4 signing params: {e}"))?;
    let params = SigningParams::from(params);

    let signable = SignableRequest::new("GET", url, std::iter::empty(), SignableBody::Bytes(&[]))
        .map_err(|e| anyhow!("failed to build signable request: {e}"))?;
    let output = sign_http(signable, &params)
        .map_err(|e| anyhow!("failed to sign request: {e}"))?;
    let (instructions, _signature) = output.into_parts();
    Ok(instructions
        .headers()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect())
}

/// Minimal in-memory XML tree used to query EC2 / RDS query-API responses.
#[derive(Debug, Clone, Default)]
pub(crate) struct XmlNode {
    pub(crate) name: String,
    pub(crate) text: String,
    pub(crate) children: Vec<XmlNode>,
}

impl XmlNode {
    pub(crate) fn child(&self, name: &str) -> Option<&XmlNode> {
        self.children.iter().find(|c| c.name == name)
    }

    pub(crate) fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a XmlNode> {
        self.children.iter().filter(move |c| c.name == name)
    }

    pub(crate) fn descendants_named(&self, name: &str) -> Vec<&XmlNode> {
        let mut out = Vec::new();
        for child in &self.children {
            if child.name == name {
                out.push(child);
            }
            out.extend(child.descendants_named(name));
        }
        out
    }

    pub(crate) fn text_of_child(&self, name: &str) -> String {
        self.child(name)
            .map(|c| c.text.clone())
            .unwrap_or_default()
    }
}

pub(crate) fn parse_xml_tree(xml: &str) -> Result<XmlNode, quick_xml::Error> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut root = XmlNode::default();
    let mut stack: Vec<XmlNode> = Vec::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                stack.push(XmlNode {
                    name,
                    ..XmlNode::default()
                });
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let node = XmlNode {
                    name,
                    ..XmlNode::default()
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    root.children.push(node);
                }
            }
            Ok(Event::End(_)) => {
                if let Some(node) = stack.pop() {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        root.children.push(node);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&t.unescape()?);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        buf.clear();
    }
    Ok(root)
}
