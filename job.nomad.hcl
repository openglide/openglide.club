variable "version" {
  type = string
}

variable "secret_access_key" {
  type = string
}

job "openglide" {
  datacenters = ["dc1"]
  namespace   = "default"

  group "task" {
    count = 2

    network {
      port "http" {
        to           = 3000
        host_network = "tailnet"
      }
    }

    task "webserver" {
      driver = "docker"
      env {
        # Workaround for 'go-migrate' bug/version of snowflake it uses https://github.com/snowflakedb/gosnowflake/issues/1321
        GODEBUG = "x509negativeserial=1"
      }
      artifact {
        source = "s3://us-ord-1.linodeobjects.com/openglide/openglide-${var.version}.tar"
        options {
          aws_access_key_id     = "VLJZW4JOWZX7EP02OMU5"
          aws_access_key_secret = var.secret_access_key
          # Leave the archive in tar format
          archive = false
        }
      }

      config {
        load  = "openglide-${var.version}.tar"
        image = "openglide:${var.version}"
        ports = ["http"]
      }

      resources {
        cpu    = 128
        memory = 64
      }

      service {
        port         = "http"
        name         = "openglide"
        provider     = "nomad"
        address_mode = "host"
      }
    }
  }
}
