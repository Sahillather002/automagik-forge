use crate::client::OmniClient;
pub use crate::types::*;
use anyhow::Result;

pub struct OmniService {
    config: OmniConfig,
    pub client: OmniClient,
}

impl OmniService {
    pub fn new(config: OmniConfig) -> Self {
        let mut service = Self {
            config: OmniConfig::default(),
            client: OmniClient::new(String::new(), None),
        };
        service.apply_config(config);
        service
    }

    pub fn apply_config(&mut self, config: OmniConfig) {
        self.client = OmniClient::new(
            config.host.clone().unwrap_or_default(),
            config.api_key.clone(),
        );
        self.config = config;
    }

    pub fn config(&self) -> &OmniConfig {
        &self.config
    }

    pub async fn send_task_notification(
        &self,
        task_title: &str,
        task_status: &str,
        task_url: Option<&str>,
    ) -> Result<()> {
        if !self.config.enabled {
            tracing::debug!("Omni notifications disabled");
            return Ok(());
        }

        let instance = self
            .config
            .instance
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No Omni instance configured"))?;
        let recipient = self
            .config
            .recipient
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No recipient configured"))?;

        tracing::info!(
            "Sending Omni notification - Instance: {}, Recipient: {}, Title: {}",
            instance,
            recipient,
            task_title
        );

        let message = format!(
            "🎯 Task Complete: {}\n\n\
             Status: {}\n\
             {}",
            task_title,
            task_status,
            task_url.map(|u| format!("URL: {}", u)).unwrap_or_default()
        );

        let request = match self.config.recipient_type {
            Some(RecipientType::PhoneNumber) => SendTextRequest {
                phone_number: Some(recipient.clone()),
                user_id: None,
                text: message,
            },
            Some(RecipientType::UserId) => SendTextRequest {
                phone_number: None,
                user_id: Some(recipient.clone()),
                text: message,
            },
            None => SendTextRequest {
                phone_number: Some(recipient.clone()),
                user_id: None,
                text: message,
            },
        };

        match self.client.send_text(instance, request).await {
            Ok(response) => {
                tracing::info!("Omni notification sent successfully: {:?}", response);
                Ok(())
            }
            Err(e) => {
                tracing::error!("Failed to send Omni notification: {}", e);
                Err(e)
            }
        }
    }

    pub async fn list_instances(&self) -> Result<Vec<OmniInstance>> {
        self.client.list_instances().await
    }
}
